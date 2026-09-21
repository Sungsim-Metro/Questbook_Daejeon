"""한글 이미지 URL과 정적 파일 경계 검사를 실제 HTTP 응답으로 검증한다."""
import importlib.util
from pathlib import Path
from threading import Thread
from urllib.parse import quote
from urllib.request import urlopen

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("questbook_asset_gateway", ROOT / "services/web-gateway/gateway.py")
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


@pytest.fixture(scope="module")
def static_server():
    server = gateway.ThreadingHTTPServer(("127.0.0.1", 0), gateway.QuestbookGatewayHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    server.server_close()
    thread.join(timeout=3)


@pytest.mark.parametrize("filename", ["기본_128.png", "기본_1024.png", "default-1.svg"])
def test_default_art_is_served_as_image_not_html(static_server, filename):
    path = "/assets/ggumdori/" + filename
    with urlopen(static_server + quote(path), timeout=3) as response:
        assert response.headers.get_content_type().startswith("image/")
        assert response.read() == (ROOT / "apps/user-web/public" / path.lstrip("/")).read_bytes()


@pytest.mark.parametrize("path", ["/%2e%2e/.env", "/src/%2e%2e/%2e%2e/.env", "/assets/%00.png", "/assets/%2e%2e/%2e%2e/.env"])
def test_decoding_does_not_allow_paths_outside_static_root(path):
    assert gateway.safe_static_path(path) is None
