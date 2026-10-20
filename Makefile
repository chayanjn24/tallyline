# Common tasks. `make` alone shows this list.
PY ?= .venv/bin/python

.PHONY: help setup run build test lint format docker
help:            ## show this list
	@grep -E '^[a-z]+:.*##' $(MAKEFILE_LIST) | sed 's/:.*## /\t/'
setup:           ## create .venv and install dependencies
	python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
run:             ## start the app on http://127.0.0.1:8000
	$(PY) -m tallyline serve
build:           ## generate the warehouse (data/tallyline.duckdb) and exit
	$(PY) -m tallyline build
test:            ## run the test suite
	$(PY) -m pytest
lint:            ## lint Python and syntax-check the JavaScript
	$(PY) -m ruff check tallyline tests && $(PY) -m ruff format --check tallyline tests
	for f in web/js/*.js web/js/*/*.js; do node --check "$$f"; done
format:          ## format Python
	$(PY) -m ruff format tallyline tests
docker:          ## build and run the container on http://localhost:8000
	docker build -t tallyline . && docker run --rm -p 8000:8000 tallyline
