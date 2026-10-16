"""Read the selected provider and test its local socket; no model requests."""
import json
from pathlib import Path
import socket
from urllib.parse import urlsplit

def local_socket(host, port):
    try:
        with socket.create_connection((host,port),timeout=.3):return True
    except OSError:return False

def gateway_health(root, deployment='mybot', probe=local_socket):
    result={'id':'dsh','name':'模型转发','kind':'gateway','arg':None,'up':None,'detail':'未确定当前模型入口'}
    try:
        root=Path(root)
        active=json.loads((root/'deployments'/deployment/'config.json').read_text(encoding='utf-8-sig'))['activeProvider']
        parent=(root/'deployments/providers').resolve()
        provider=(parent/active).resolve()
        if provider.parent!=parent:raise ValueError('invalid provider')
        config=json.loads((provider/'config.json').read_text(encoding='utf-8-sig'))
        url=urlsplit(config['baseUrl'])
        if url.scheme not in ('http','https') or not url.hostname:raise ValueError('invalid URL')
        port=url.port or (443 if url.scheme=='https' else 80)
        if url.hostname not in ('127.0.0.1','localhost','::1'):
            result['detail']=f'{active} · 远程渠道，未做网络探测'
            return result
        up=probe(url.hostname,port)
        result.update(up=up,arg=port,detail=f'{active} · {url.hostname}:{port} · '+('端口在线（不代表额度可用）' if up else '端口未监听'))
    except (OSError,ValueError,KeyError,TypeError):
        result['detail']='当前通道配置不可读取；不按旧的固定端口判断离线'
    return result
