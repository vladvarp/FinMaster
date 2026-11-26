"""Журнал дисковых операций и мониторинг процессов WebView2 FinMaster."""
from __future__ import annotations
import ctypes, os, re, threading, time

_LOCK=threading.Lock()
_EVENTS:list[dict]=[]
_NEXT=1
_SIZES:dict[str,int]={}
_SAMPLED=0.0

def _fmt(n:int)->str:
    n=max(0,int(n))
    if n<1024:return f"{n} Б"
    if n<1024*1024:return f"{n/1024:.1f} КБ"
    if n<1024**3:return f"{n/1024**2:.1f} МБ"
    return f"{n/1024**3:.2f} ГБ"

def note(path:str,nbytes:int)->None:
    global _NEXT
    full=os.path.abspath(str(path or ""))
    with _LOCK:
        _EVENTS.append({"id":_NEXT,"ts":time.time(),"path":full,"bytes":int(nbytes),"total":int(nbytes),"fresh":True})
        _NEXT+=1
        del _EVENTS[:-400]

def _dir_size(path:str)->int:
    total=0;seen=0
    for root,dirs,files in os.walk(path):
        dirs[:]=[n for n in dirs if n not in {"Crashpad","BrowserMetrics"}]
        for name in files:
            seen+=1
            if seen>6000:return total
            try:total+=os.path.getsize(os.path.join(root,name))
            except OSError:continue
    return total

def _sample()->None:
    global _SAMPLED,_NEXT
    now=time.time()
    if now-_SAMPLED<3:return
    _SAMPLED=now
    local=os.environ.get("LOCALAPPDATA") or ""
    root=os.path.join(local,"pywebview","EBWebView") if local else ""
    if not root or not os.path.isdir(root):return
    grown=[]
    try:names=[n for n in os.listdir(root) if os.path.isdir(os.path.join(root,n))]
    except OSError:return
    for name in names:
        path=os.path.join(root,name);size=_dir_size(path);prev=_SIZES.get(path);_SIZES[path]=size
        if prev is not None and size>prev:grown.append((path,size-prev,size))
    if not grown:return
    with _LOCK:
        for path,delta,size in grown:
            _EVENTS.append({"id":_NEXT,"ts":now,"path":path,"bytes":delta,"total":size,"fresh":False})
            _NEXT+=1
        del _EVENTS[:-400]

def since(after:int)->dict:
    _sample()
    with _LOCK:
        events=[dict(x) for x in _EVENTS if x["id"]>after];last=_NEXT-1
    return {"ok":True,"events":events,"last_id":last}

def clear()->dict:
    global _EVENTS
    with _LOCK:_EVENTS=[];last=_NEXT-1
    return {"ok":True,"last_id":last}

class _IO(ctypes.Structure):
    _fields_=[(n,ctypes.c_ulonglong) for n in ("rops","wops","oops","rbytes","wbytes","obytes")]
class _PE(ctypes.Structure):
    _fields_=[("dwSize",ctypes.c_uint32),("cntUsage",ctypes.c_uint32),("pid",ctypes.c_uint32),
      ("heap",ctypes.c_void_p),("mod",ctypes.c_uint32),("threads",ctypes.c_uint32),
      ("ppid",ctypes.c_uint32),("pri",ctypes.c_long),("flags",ctypes.c_uint32),("exe",ctypes.c_wchar*260)]
class _UNICODE_STRING(ctypes.Structure):
    _fields_=[("Length",ctypes.c_ushort),("MaximumLength",ctypes.c_ushort),("Buffer",ctypes.c_void_p)]

_K32=ctypes.WinDLL("kernel32",use_last_error=True)
_K32.CreateToolhelp32Snapshot.restype=ctypes.c_void_p
_K32.CreateToolhelp32Snapshot.argtypes=[ctypes.c_uint32,ctypes.c_uint32]
_K32.Process32FirstW.argtypes=[ctypes.c_void_p,ctypes.POINTER(_PE)];_K32.Process32FirstW.restype=ctypes.c_int
_K32.Process32NextW.argtypes=[ctypes.c_void_p,ctypes.POINTER(_PE)];_K32.Process32NextW.restype=ctypes.c_int
_K32.OpenProcess.restype=ctypes.c_void_p
_K32.OpenProcess.argtypes=[ctypes.c_uint32,ctypes.c_int,ctypes.c_uint32]
_K32.GetProcessIoCounters.argtypes=[ctypes.c_void_p,ctypes.POINTER(_IO)];_K32.GetProcessIoCounters.restype=ctypes.c_int
_K32.CloseHandle.argtypes=[ctypes.c_void_p];_K32.CloseHandle.restype=ctypes.c_int
_NTDLL=ctypes.WinDLL("ntdll")
_NTDLL.NtQueryInformationProcess.argtypes=[ctypes.c_void_p,ctypes.c_uint32,ctypes.c_void_p,ctypes.c_uint32,ctypes.POINTER(ctypes.c_uint32)]
_NTDLL.NtQueryInformationProcess.restype=ctypes.c_long

_EDGE_PREV:dict[int,tuple[tuple,int,float]]={}
_LOCAL_EDGE_ROOT=os.path.join(os.environ.get("LOCALAPPDATA") or "","pywebview","EBWebView")

def _process_command_line(handle)->str:
    buf=ctypes.create_string_buffer(65536);returned=ctypes.c_uint32()
    status=_NTDLL.NtQueryInformationProcess(handle,60,buf,len(buf),ctypes.byref(returned))
    if status<0:return ""
    try:
        value=ctypes.cast(buf,ctypes.POINTER(_UNICODE_STRING)).contents
        return ctypes.wstring_at(value.Buffer,value.Length//2) if value.Buffer and value.Length else ""
    except (ValueError,OSError):return ""

def _argument(command_line:str,name:str)->str:
    m=re.search(rf'(?:^|\s){re.escape(name)}(?:=|\s+)("(?:[^"]*)"|[^\s]+)',command_line,re.I)
    return m.group(1).strip('"') if m else ""

def _process_role(command_line:str)->str:
    kind=_argument(command_line,"--type").lower()
    subtype=_argument(command_line,"--utility-sub-type").lower()
    if kind=="renderer":return "Рендерер интерфейса"
    if kind=="gpu-process":return "Графика и GPU"
    if kind=="utility":
        if "network" in subtype:return "Сетевой сервис"
        if "storage" in subtype:return "Хранилище WebView"
        if "audio" in subtype:return "Аудиосервис"
        if "data_decoder" in subtype:return "Декодирование данных"
        return f"Служебный процесс · {subtype or 'utility'}"
    if kind=="crashpad-handler":return "Обработчик сбоев"
    return f"Служебный процесс · {kind}" if kind else "Основной процесс WebView2"

def _edge_now()->list[dict]:
    """Только процессы msedgewebview2.exe из дерева текущего процесса FinMaster."""
    snap=_K32.CreateToolhelp32Snapshot(0x2,0)
    if not snap or snap==ctypes.c_void_p(-1).value:return []
    tree={};pe=_PE();pe.dwSize=ctypes.sizeof(pe)
    try:
        ok=_K32.Process32FirstW(snap,ctypes.byref(pe))
        while ok:
            tree[int(pe.pid)]={"ppid":int(pe.ppid),"exe":str(pe.exe)}
            ok=_K32.Process32NextW(snap,ctypes.byref(pe))
    finally:_K32.CloseHandle(snap)
    descendants={os.getpid()};changed=True
    while changed:
        changed=False
        for pid,item in tree.items():
            if pid not in descendants and item["ppid"] in descendants:
                descendants.add(pid);changed=True
    rows=[]
    for pid in descendants:
        info=tree.get(pid)
        if not info or info["exe"].lower()!="msedgewebview2.exe":continue
        handle=_K32.OpenProcess(0x1410,False,pid)
        if not handle:continue
        try:
            io=_IO()
            if not _K32.GetProcessIoCounters(handle,ctypes.byref(io)):continue
            cmd=_process_command_line(handle)
        finally:_K32.CloseHandle(handle)
        user_data=_argument(cmd,"--user-data-dir");disk_cache=_argument(cmd,"--disk-cache-dir")
        parent=tree.get(info["ppid"],{})
        rows.append({"pid":pid,"ppid":info["ppid"],"parent":parent.get("exe") or "процесс завершён",
          "exe":info["exe"],"role":_process_role(cmd),
          "where":disk_cache or user_data or _LOCAL_EDGE_ROOT or "путь профиля не определён",
          "where_kind":"Папка кэша" if disk_cache else ("Профиль WebView2" if user_data else "Общая папка WebView2"),
          "write_bytes":int(io.wbytes),"read_bytes":int(io.rbytes),"write_ops":int(io.wops),
          "read_ops":int(io.rops),"command_line":cmd})
    rows.sort(key=lambda x:(x["role"],x["pid"]))
    return rows

def edge_since(after:int=0)->dict:
    """Снимок процессов FinMaster, а не поток повторяющихся строк по каждому PID."""
    now=time.monotonic();processes=[];total_delta=total_rate=total_written=total_read=total_ops=0;alive=set()
    for item in _edge_now():
        pid=item["pid"];alive.add(pid);signature=(item["ppid"],item["command_line"])
        previous=_EDGE_PREV.get(pid);delta=0;elapsed=0.0
        if previous and previous[0]==signature:
            delta=max(0,item["write_bytes"]-previous[1]);elapsed=max(.001,now-previous[2])
        rate=int(delta/elapsed) if elapsed else 0
        _EDGE_PREV[pid]=(signature,item["write_bytes"],now)
        item["write_delta"]=delta;item["write_rate"]=rate
        total_delta+=delta;total_rate+=rate;total_written+=item["write_bytes"];total_read+=item["read_bytes"];total_ops+=item["write_ops"]
        processes.append(item)
    for pid in list(_EDGE_PREV):
        if pid not in alive:_EDGE_PREV.pop(pid,None)
    return {"ok":True,"sampled_at":time.time(),"processes":processes,
      "totals":{"process_count":len(processes),"write_delta":total_delta,"write_rate":total_rate,
      "written":total_written,"read":total_read,"write_ops":total_ops},"last_id":0}

def edge_clear()->dict:
    _EDGE_PREV.clear()
    return {"ok":True,"last_id":0}
