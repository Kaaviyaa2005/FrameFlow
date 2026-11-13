import sys
import os

# Add the project root directory to Python system paths
current_dir = os.path.dirname(os.path.abspath(__file__))
root_dir = os.path.dirname(current_dir)
sys.path.append(root_dir)

try:
    from app.main import app
except Exception as e:
    # Fallback to print traceback in serverless logs if import fails
    import traceback
    traceback.print_exc()
    raise e
