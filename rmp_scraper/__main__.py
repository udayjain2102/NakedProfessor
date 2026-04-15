import os
import sys

try:
    from .cli import main
except ImportError:
    # Allow direct execution from the project root with `python rmp_scraper/__main__.py`.
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from rmp_scraper.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
