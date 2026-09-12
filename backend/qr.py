"""Генератор QR-кодов без внешних зависимостей.

Поддерживает байтовый режим, уровень коррекции M и версии 1-6
(до 108 байт полезных данных) — этого с запасом хватает для ссылки вида
http://192.168.1.50:51234/m?t=TOKEN.
"""

from __future__ import annotations

_EXP = [0] * 512
_LOG = [0] * 256


def _init_tables() -> None:
    x = 1
    for i in range(255):
        _EXP[i] = x
        _LOG[x] = i
        x <<= 1
        if x & 0x100:
            x ^= 0x11D
    for i in range(255, 512):
        _EXP[i] = _EXP[i - 255]


_init_tables()

# версия -> (всего кодовых слов, слов коррекции на блок, размеры блоков данных, центры выравнивания)
_VERSIONS: dict[int, tuple[int, int, list[int], list[int]]] = {
    1: (26, 10, [16], []),
    2: (44, 16, [28], [6, 18]),
    3: (70, 26, [44], [6, 22]),
    4: (100, 18, [32, 32], [6, 26]),
    5: (134, 24, [43, 43], [6, 30]),
    6: (172, 16, [27, 27, 27, 27], [6, 34]),
}

_MASKS = (
    lambda i, j: (i + j) % 2 == 0,
    lambda i, j: i % 2 == 0,
    lambda i, j: j % 3 == 0,
    lambda i, j: (i + j) % 3 == 0,
    lambda i, j: (i // 2 + j // 3) % 2 == 0,
    lambda i, j: (i * j) % 2 + (i * j) % 3 == 0,
    lambda i, j: ((i * j) % 2 + (i * j) % 3) % 2 == 0,
    lambda i, j: ((i + j) % 2 + (i * j) % 3) % 2 == 0,
)

_G15 = 0b101_0011_0111
_G15_MASK = 0b101_0100_0001_0010


def _mul(a: int, b: int) -> int:
    if a == 0 or b == 0:
        return 0
    return _EXP[_LOG[a] + _LOG[b]]


def _generator(ec_len: int) -> list[int]:
    poly = [1]
    for i in range(ec_len):
        nxt = [0] * (len(poly) + 1)
        for j, coef in enumerate(poly):
            nxt[j] ^= coef
            nxt[j + 1] ^= _mul(coef, _EXP[i])
        poly = nxt
    return poly


def _ec_codewords(data: list[int], ec_len: int) -> list[int]:
    gen = _generator(ec_len)
    res = list(data) + [0] * ec_len
    for i in range(len(data)):
        coef = res[i]
        if not coef:
            continue
        for j, g in enumerate(gen):
            res[i + j] ^= _mul(g, coef)
    return res[len(data):]


def _bch_format(value: int) -> int:
    d = value << 10
    while d.bit_length() - _G15.bit_length() >= 0:
        d ^= _G15 << (d.bit_length() - _G15.bit_length())
    return ((value << 10) | d) ^ _G15_MASK


def _pick_version(length: int) -> int:
    for version, (_, _, blocks, _) in _VERSIONS.items():
        if length + 2 <= sum(blocks):
            return version
    raise ValueError("Слишком длинные данные для QR-кода.")


def _codewords(payload: bytes, version: int) -> list[int]:
    _, ec_len, blocks, _ = _VERSIONS[version]
    capacity = sum(blocks)
    bits: list[int] = []

    def put(value: int, length: int) -> None:
        for shift in range(length - 1, -1, -1):
            bits.append((value >> shift) & 1)

    put(0b0100, 4)
    put(len(payload), 8)
    for byte in payload:
        put(byte, 8)
    for _ in range(min(4, capacity * 8 - len(bits))):
        bits.append(0)
    while len(bits) % 8:
        bits.append(0)

    data = [int("".join(str(b) for b in bits[i : i + 8]), 2) for i in range(0, len(bits), 8)]
    pads = (0xEC, 0x11)
    pad_index = 0
    while len(data) < capacity:
        data.append(pads[pad_index % 2])
        pad_index += 1

    data_blocks: list[list[int]] = []
    ec_blocks: list[list[int]] = []
    pos = 0
    for size in blocks:
        chunk = data[pos : pos + size]
        pos += size
        data_blocks.append(chunk)
        ec_blocks.append(_ec_codewords(chunk, ec_len))

    out: list[int] = []
    for i in range(max(blocks)):
        for block in data_blocks:
            if i < len(block):
                out.append(block[i])
    for i in range(ec_len):
        for block in ec_blocks:
            out.append(block[i])
    return out


def _place_patterns(grid: list[list[int | None]], version: int) -> None:
    n = len(grid)

    for base_r, base_c in ((0, 0), (0, n - 7), (n - 7, 0)):
        for r in range(-1, 8):
            for c in range(-1, 8):
                rr, cc = base_r + r, base_c + c
                if not (0 <= rr < n and 0 <= cc < n):
                    continue
                edge = r in (0, 6) and 0 <= c <= 6
                side = c in (0, 6) and 0 <= r <= 6
                core = 2 <= r <= 4 and 2 <= c <= 4
                grid[rr][cc] = 1 if (edge or side or core) else 0

    for i in range(8, n - 8):
        grid[6][i] = 1 if i % 2 == 0 else 0
        grid[i][6] = 1 if i % 2 == 0 else 0

    centers = _VERSIONS[version][3]
    for r in centers:
        for c in centers:
            if grid[r][c] is not None:
                continue
            for dr in range(-2, 3):
                for dc in range(-2, 3):
                    grid[r + dr][c + dc] = 0 if max(abs(dr), abs(dc)) == 1 else 1

    grid[n - 8][8] = 1

    for i in range(9):
        if grid[8][i] is None:
            grid[8][i] = 0
        if grid[i][8] is None:
            grid[i][8] = 0
    for i in range(8):
        if grid[8][n - 1 - i] is None:
            grid[8][n - 1 - i] = 0
        if grid[n - 1 - i][8] is None:
            grid[n - 1 - i][8] = 0


def _place_data(grid: list[list[int | None]], data: list[int], mask: int) -> None:
    n = len(grid)
    fn = _MASKS[mask]
    row = n - 1
    inc = -1
    bit_index = 7
    byte_index = 0
    col = n - 1
    while col > 0:
        if col == 6:
            col -= 1
        while True:
            for c in (col, col - 1):
                if grid[row][c] is not None:
                    continue
                dark = False
                if byte_index < len(data):
                    dark = ((data[byte_index] >> bit_index) & 1) == 1
                if fn(row, c):
                    dark = not dark
                grid[row][c] = 1 if dark else 0
                bit_index -= 1
                if bit_index == -1:
                    byte_index += 1
                    bit_index = 7
            row += inc
            if row < 0 or row >= n:
                row -= inc
                inc = -inc
                break
        col -= 2


def _place_format(grid: list[list[int | None]], mask: int) -> None:
    n = len(grid)
    bits = _bch_format(mask)
    for i in range(15):
        bit = (bits >> i) & 1
        if i < 6:
            grid[i][8] = bit
        elif i < 8:
            grid[i + 1][8] = bit
        else:
            grid[n - 15 + i][8] = bit
    for i in range(15):
        bit = (bits >> i) & 1
        if i < 8:
            grid[8][n - i - 1] = bit
        elif i == 8:
            grid[8][7] = bit
        else:
            grid[8][14 - i] = bit
    grid[n - 8][8] = 1


def _penalty(grid: list[list[int]]) -> int:
    n = len(grid)
    score = 0

    for line in list(grid) + [list(col) for col in zip(*grid)]:
        run = 1
        for i in range(1, n):
            if line[i] == line[i - 1]:
                run += 1
            else:
                if run >= 5:
                    score += 3 + (run - 5)
                run = 1
        if run >= 5:
            score += 3 + (run - 5)

    for r in range(n - 1):
        for c in range(n - 1):
            block = grid[r][c] + grid[r][c + 1] + grid[r + 1][c] + grid[r + 1][c + 1]
            if block in (0, 4):
                score += 3

    # Шаблон 1:1:3:1:1, окружённый светлой зоной шириной 4 модуля (край символа считается светлым).
    pattern = [1, 0, 1, 1, 1, 0, 1]
    for line in list(grid) + [list(col) for col in zip(*grid)]:
        i = 0
        while i <= n - 7:
            if line[i : i + 7] != pattern:
                i += 1
                continue
            if not any(line[max(i - 4, 0) : i]) or not any(line[i + 7 : i + 11]):
                score += 40
                i += 7
            else:
                i += 4

    dark = sum(sum(row) for row in grid)
    percent = dark * 100 / (n * n)
    score += 10 * (int(abs(percent - 50) / 5))
    return score


def matrix(text: str) -> list[list[int]]:
    """Возвращает матрицу модулей QR-кода (1 — тёмный)."""
    payload = text.encode("utf-8")
    version = _pick_version(len(payload))
    data = _codewords(payload, version)
    n = 17 + version * 4

    best: list[list[int]] | None = None
    best_score = 0
    for mask in range(8):
        grid: list[list[int | None]] = [[None] * n for _ in range(n)]
        _place_patterns(grid, version)
        _place_data(grid, data, mask)
        _place_format(grid, mask)
        solid = [[int(cell or 0) for cell in row] for row in grid]
        score = _penalty(solid)
        if best is None or score < best_score:
            best, best_score = solid, score
    assert best is not None
    return best


def svg(text: str, module: int = 8, quiet: int = 4, dark: str = "#0b1220", light: str = "#ffffff") -> str:
    """Рисует QR-код в виде самодостаточного SVG."""
    grid = matrix(text)
    n = len(grid)
    side = (n + quiet * 2) * module
    path = []
    for r, row in enumerate(grid):
        for c, cell in enumerate(row):
            if cell:
                path.append(f"M{(c + quiet) * module} {(r + quiet) * module}h{module}v{module}h-{module}z")
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{side}" height="{side}" '
        f'viewBox="0 0 {side} {side}" shape-rendering="crispEdges" role="img" aria-label="QR-код">'
        f'<rect width="{side}" height="{side}" rx="{module * 2}" fill="{light}"/>'
        f'<path fill="{dark}" d="{"".join(path)}"/>'
        "</svg>"
    )
