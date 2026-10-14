"""Put this Lambda's own directory on the path.

Each Lambda deploys as a flat bundle where `handler` is a top-level module, so the tests
import it the same way the runtime does. With pytest's importlib import mode the test
directory is not added automatically, and two Lambdas both having `handler.py` is exactly
why importlib mode is on.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
