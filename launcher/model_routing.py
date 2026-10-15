"""主模型模式与端点选择；仅调用配置接口，不发送推理探测。"""
import json
import os
import pathlib
import threading
import uuid
import urllib.error
import urllib.parse
import urllib.request


class ModelRouting:
    def __init__(self, file, url, stop_guard, start_guard, request=None):
        self.file = pathlib.Path(file)
        self.url = url.rstrip('/')
        self.stop_guard = stop_guard
        self.start_guard = start_guard
        self.request = request or self._request
        self.lock = threading.Lock()

    def _request(self, path, method='GET'):
        req = urllib.request.Request(self.url + path, data=b'{}' if method == 'POST' else None, method=method,
                                     headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=8) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            raise RuntimeError(f'控制台请求失败（HTTP {error.code}）') from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise RuntimeError('无法连接 Cortico 控制台，请确认服务已启动') from None

    def state(self):
        try:
            if not self.file.exists():
                return {'version': 1, 'mode': 'auto', 'provider': ''}
            data = json.loads(self.file.read_text(encoding='utf-8'))
            if data.get('version') != 1 or data.get('mode') not in ('auto', 'manual'):
                raise ValueError('模式记录格式不支持')
            return {'version': 1, 'mode': data['mode'], 'provider': str(data.get('provider', ''))}
        except (OSError, ValueError, TypeError, AttributeError):
            return {'version': 1, 'mode': 'manual', 'provider': '', 'error': '模式记录无法读取；自动切换已暂停，请重新选择模式'}

    def _save(self, value):
        self.file.parent.mkdir(parents=True, exist_ok=True)
        temp = self.file.with_name(self.file.name + '.' + uuid.uuid4().hex + '.tmp')
        try:
            temp.write_text(json.dumps(value, ensure_ascii=False) + '\n', encoding='utf-8')
            os.replace(temp, self.file)
        finally:
            temp.unlink(missing_ok=True)

    def options(self):
        data = self.request('/api/providers')
        return {'ok': True, 'active': data.get('active', ''), 'routing': self.state(),
                'providers': [{'id': p['id'], 'name': p.get('name', p['id']), 'model': p.get('model', '')}
                              for p in data.get('providers', []) if isinstance(p, dict) and p.get('id') and p.get('model')]}

    def apply(self, mode, provider=''):
        if mode not in ('auto', 'manual') or not isinstance(provider, str):
            return {'ok': False, 'msg': '请选择自动或手动模式及有效端点'}
        if not self.lock.acquire(blocking=False):
            return {'ok': False, 'msg': '模型模式正在切换，请稍候'}
        try:
            previous = self.state()
            if mode == 'auto':
                self._save({'version': 1, 'mode': 'auto', 'provider': ''})
                started = self.start_guard()
                if not started.get('ok'):
                    return {'ok': False, 'msg': '自动模式已保存，但守护未启动：' + started.get('msg', '')}
                return {'ok': True, 'msg': '已恢复自动模式，沿用现有故障切换与恢复逻辑'}
            options = self.options()
            if provider not in {p['id'] for p in options['providers']}:
                return {'ok': False, 'msg': '请选择控制台中已配置的模型端点'}
            self._save({'version': 1, 'mode': 'manual', 'provider': provider})
            try:
                stopped = self.stop_guard()
                if not stopped.get('ok'):
                    raise RuntimeError(stopped.get('msg', '未能停止自动守护'))
            except Exception:
                self._save(previous)
                raise RuntimeError('未能停止自动守护，模型未切换，请稍后重试') from None
            self.request('/api/providers/' + urllib.parse.quote(provider, safe='') + '/activate', 'POST')
            if self.request('/api/providers').get('active') != provider:
                raise RuntimeError('控制台尚未确认所选端点生效；手动模式保持，不会自动换线路')
            return {'ok': True, 'msg': '已切为手动模式；主模型固定为 ' + provider + '，限流时不会自动换线路'}
        except Exception as error:
            return {'ok': False, 'msg': str(error)}
        finally:
            self.lock.release()
