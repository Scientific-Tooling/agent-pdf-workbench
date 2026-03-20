from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from agent_pdf_workbench.viewer_server import _is_within_directory


class ViewerServerTest(unittest.TestCase):
    def test_is_within_directory_rejects_prefix_collision(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            web_dir = (root / "web").resolve()
            sibling = (root / "web2" / "secret.txt").resolve()
            web_dir.mkdir(parents=True, exist_ok=True)
            sibling.parent.mkdir(parents=True, exist_ok=True)
            sibling.write_text("secret", encoding="utf-8")

            self.assertFalse(_is_within_directory(sibling, web_dir))
            self.assertTrue(_is_within_directory((web_dir / "index.html").resolve(), web_dir))


if __name__ == "__main__":
    unittest.main()
