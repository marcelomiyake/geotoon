SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

GIT_SHA ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)
IMAGE ?= geotoon-app
CLUSTER ?= geotoon
NAMESPACE ?= geotoon
PG_DEV_CONTAINER ?= geotoon-pg-dev

.PHONY: help setup dev db-up db-down build typecheck lint test images kind-up kind-load deploy open verify-cache sonar kind-down

help: ## List the targets
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-14s %s\n", $$1, $$2}'

setup: ## Install dependencies (npm ci)
	npm ci

db-up: ## Start a local PostGIS container on port 5432
	docker start $(PG_DEV_CONTAINER) 2>/dev/null || docker run -d --name $(PG_DEV_CONTAINER) \
	  -e POSTGRES_DB=geotoon -e POSTGRES_USER=geotoon -e POSTGRES_PASSWORD=local-dev-only \
	  -p 127.0.0.1:5432:5432 postgis/postgis:17-3.6

db-down: ## Remove the local PostGIS container
	docker rm -f $(PG_DEV_CONTAINER)

dev: db-up ## PostGIS in Docker, the API on :8080 and Vite on :5173 (proxying /api)
	npm run dev -w @geotoon/api & npm run dev -w @geotoon/web; wait

build: ## Build every package and the web client
	npm run build

typecheck: ## Type-check every package
	npm run typecheck

lint: ## ESLint (with SonarJS rules) and dependency rules
	npm run lint

test: ## Lint, then unit and integration tests with coverage (needs Docker for PostGIS)
	npm run lint
	npm test

images: ## Build the app image geotoon-app:$(GIT_SHA)
	docker build -f docker/app.Dockerfile --build-arg GIT_SHA=$(GIT_SHA) -t $(IMAGE):$(GIT_SHA) .

kind-up: ## Create the Kind cluster
	kind get clusters | grep -qx $(CLUSTER) || kind create cluster --config deploy/kind/kind-config.yaml

kind-load: ## Load the app image into Kind (the node pulls PostGIS by digest)
	kind load docker-image --name $(CLUSTER) $(IMAGE):$(GIT_SHA)

deploy: ## helm upgrade --install with the current image tag
	helm upgrade --install geotoon deploy/helm/geotoon --namespace $(NAMESPACE) --create-namespace \
	  --set image.tag=$(GIT_SHA) --wait --timeout 5m

open: ## Port-forward the app to http://localhost:8080
	kubectl --namespace $(NAMESPACE) port-forward svc/geotoon 8080:80

verify-cache: ## Prove a repeated area request reads only from PostGIS (needs `make open`)
	scripts/verify-cache.sh http://localhost:8080

sonar: ## Run the SonarCloud scan (needs SONAR_TOKEN)
	npx --yes @sonar/scan@4.3.2 -Dsonar.token=$${SONAR_TOKEN:?set SONAR_TOKEN}

kind-down: ## Delete the Kind cluster
	kind delete cluster --name $(CLUSTER)
