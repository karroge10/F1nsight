import os
import runpy
import sys

sys.path[0] = os.getcwd()
module = sys.argv.pop(1)
try:
    runpy.run_module(module, run_name="__main__", alter_sys=True)
except SystemExit as error:
    if error.code is not None and error.code != 0:
        raise
sys.stdout.flush()
sys.stderr.flush()
os._exit(0)
