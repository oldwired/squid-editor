# TORAIZ SQUID browser editor

A local browser editor for SQUID Manager `.prj` files. Edit projects, generate
patterns, import/export MIDI, and transfer projects directly over WebHID.

## Run

From this repository:

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory project-editor
```

Open <http://127.0.0.1:8766/>. Choose **New project**, **Open .prj**, or explore the
original editor example. No package installation or build step is required.
Files stay local. Direct USB transfers require Chrome/Chromium on localhost or
HTTPS.

The example is generated from code with simple original note sequences. New
projects use explicit format defaults. No factory demos or captured project
headers are bundled.

See the [editor guide](project-editor/README.md) for editing, shortcuts, drum
views, MIDI, recovery, USB transfers, and validation limits.

## Checks

Node.js and Python 3 are required for the test suites:

```sh
node --test project-editor/*.test.cjs
python3 -m unittest discover -s tests -v
```

Tests use synthetic fixtures generated from code and an independent Python
project decoder. USB transfers are tested with a simulated device; these checks
do not access hardware. Device projects and research artifacts are excluded
from this repository.

## License

[MIT](LICENSE) — Copyright (c) 2026 squid-editor contributors.

This is an independent editor for the TORAIZ SQUID. It is not affiliated with or
endorsed by Pioneer/TORAIZ.
