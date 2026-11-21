import json
import sys
from pathlib import Path

server_root = Path(__file__).resolve().parents[1] / "apps/server"
sys.path.insert(0, str(server_root))

from app.main import app

output = Path(__file__).resolve().parents[1] / 'apps/web/src/shared/api/openapi.json'
output.write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(output)
