WEB_DIRECTORY = "./web"
__version__ = "0.1.0"

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY", "__version__"]

try:
	import contextlib
	import json
	import re
	import tempfile
	import time
	from pathlib import Path

	from aiohttp import web
	from server import PromptServer
except Exception:
	PromptServer = None
else:
	TEMP_WORKFLOW_DIR_NAME = "metadata-booster-workflows"
	MAX_TEMP_WORKFLOW_AGE_SECONDS = 60 * 60 * 24
	MAX_TEMP_WORKFLOW_FILES = 100


	def _build_temp_workflow_name(filename):
		stem = re.sub(r"\.[^.]+$", "", str(filename or "workflow")).strip()
		stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-._")
		stem = stem[:120] or "workflow"
		return f"{stem}.json"


	def _prune_temp_workflows(temp_dir):
		candidates = []
		now = time.time()

		for path in temp_dir.glob("*.json"):
			try:
				stat = path.stat()
			except OSError:
				continue

			if now - stat.st_mtime > MAX_TEMP_WORKFLOW_AGE_SECONDS:
				with contextlib.suppress(OSError):
					path.unlink()
				continue

			candidates.append((stat.st_mtime, path))

		if len(candidates) <= MAX_TEMP_WORKFLOW_FILES:
			return

		for _, path in sorted(candidates, key=lambda item: item[0])[:-MAX_TEMP_WORKFLOW_FILES]:
			with contextlib.suppress(OSError):
				path.unlink()


	@PromptServer.instance.routes.post("/metadata-booster/save-workflow")
	async def metadata_booster_save_workflow(request):
		try:
			payload = await request.json()
		except Exception:
			return web.json_response({"error": "Invalid JSON payload."}, status=400)

		workflow = payload.get("workflow")
		if not isinstance(workflow, dict) or not workflow:
			return web.json_response(
				{"error": "A valid workflow object is required."},
				status=400,
			)

		temp_dir = Path(tempfile.gettempdir()) / TEMP_WORKFLOW_DIR_NAME
		temp_dir.mkdir(parents=True, exist_ok=True)
		_prune_temp_workflows(temp_dir)

		base_name = _build_temp_workflow_name(payload.get("filename"))
		base_stem = Path(base_name).stem
		output_path = temp_dir / base_name
		suffix = 1
		while output_path.exists():
			output_path = temp_dir / f"{base_stem}-{suffix}.json"
			suffix += 1

		output_path.write_text(json.dumps(workflow, indent=2), encoding="utf-8")

		return web.json_response(
			{
				"status": "ok",
				"fileName": output_path.name,
			}
		)
