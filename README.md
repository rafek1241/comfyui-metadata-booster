![Metadata Booster](./public/banner.png)

# Metadata Booster

Metadata Booster is a standalone ComfyUI frontend extension that adds quick metadata inspection tools for previewed media.

## Features

- `PNG Info` right-click actions for node previews and Assets/media previews
- metadata browser sidebar for dropped local files, folders, and live generated workflow previews
- grouped metadata dialog for Comfy prompt/workflow metadata
- `Copy metadata to clipboard` as formatted JSON
- `Open workflow in ComfyUI` for embedded workflow JSON
- optional lightweight Assets/media hover preview with configurable fields
- embedded video metadata support for MP4/MOV/M4V and WebM/MKV files when metadata is present in the container

## Installation

1. Copy the `comfyui-metadata-booster` repository into your `custom_nodes` directory.
2. Restart ComfyUI.

## Settings

- `Metadata Booster: Enable metadata browser sidebar`
- `Metadata Booster: Auto-load generated media in metadata browser`
- `Metadata Booster: Enable Assets/media metadata preview`
- `Metadata Booster: Assets/media preview fields`

## Notes

- Image metadata uses the same frontend PNG/WebP/AVIF readers already shipped with ComfyUI.
- Video support is client-side only and reads embedded container metadata directly from the previewed file.
- The metadata browser accepts file and folder drops and can also track active node preview outputs in the current workflow.
- Unsupported formats and files without embedded metadata surface an explicit status message instead of failing silently.
