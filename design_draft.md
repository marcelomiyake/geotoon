# GeoToon: Walkable Cel-Shaded 3D Map Built from Open Map Data

*   **Author:** Marcelo Miyake
*   **Status:** Draft
*   **Date:** 2026-11-01

--------------------------------------------------------------------------------

## Overview

GeoToon turns an address into a small world you can walk through. A person
types an address in a browser, picks one of the suggestions, and after a
short wait stands at street level inside a cel-shaded 3D model of the
neighbourhood around that address. Cel shading (toon shading) means lighting
reduced to a few flat colour bands, plus dark outlines.

The model contains buildings raised from their footprints, streets, parks,
water and trees. It is built only from open map data: Overture Maps, which
also distributes OpenStreetMap (OSM) data. The first time an area is
requested, the data is fetched and stored in PostgreSQL with PostGIS; every
later request for that area reads from the database. Address suggestions come
from Photon, an open-source geocoder.

The whole system runs on a local Kubernetes cluster (Kind) and is installed
by one Helm chart. The proof of concept (PoC) targets Av. Bolonha, 200,
Jaguaré, São Paulo (lat -23.5486, lon -46.7469).

This design follows `concepts_brief.md` (brainstorm, six-lens review, Stage 0
measurements and decisions D1 to D13).

## The Problem

**No free, legal way to walk a real place in a stylised form.** Google Earth
has detailed 3D cities, but Google's terms forbid storing, exporting or
rebuilding them. Their meshes also suit toon shading badly: they are unlit,
have shadows baked into the photos, and fuse trees, cars and buildings into
one surface (Reference 1).

**Open data can be stored and restyled, but it is not 3D and it is
incomplete.**
- It arrives as flat 2D footprints and lines.
- It is spread across several themes and monthly releases.
- Heights are missing for most buildings: 1% of the 6,719 buildings within
  1 km of the PoC address have a height, and 95% have no building type.
- Something has to raise footprints into 3D, estimate the missing heights in
  a repeatable way, and keep the layers consistent.

**Fetching open data is slow and relies on shared infrastructure.**
- One Overture read from cloud storage took 17 to 38 s per theme in Stage 0.
- The public Overpass (OSM) server queued each query for 30 to 50 s and
  refused back-to-back queries.
- Fetching on every visit would make every visit slow and load public
  services. Each area must be fetched once and reused.

**Proposed solution.** A browser client sends the chosen point to an API.
The API works out which fixed map tiles cover the requested radius, fetches
only the tiles it has not stored yet from Overture (buildings, streets, land
use, water, trees), stores them in PostGIS, and returns one scene payload.
The browser raises the footprints into 3D, applies toon materials and
outlines, and lets the user walk through the result.

## Goals

Each goal is a pass/fail check. G1 to G5 are the owner's done criteria.

*   **G1. Address to scene.** Typing an address shows suggestions. Picking
    one shows a cel-shaded 3D scene around that point, with the camera at
    street level near the address.
*   **G2. Fetch once.** A second request for an area makes zero calls to
    external data sources and reads only from PostGIS. The response shows,
    per tile, whether it was read from storage or fetched, and counts the
    source calls made.
*   **G3. One-command install.** On a fresh Kind cluster with the images
    loaded, `helm install` brings up the app and PostGIS, and the app opens
    in a browser through the port-forward command the chart prints.
*   **G4. Tests.** `make test` passes without network access.
*   **G5. Code quality.** SonarCloud project `marcelomiyake_geotoon` shows,
    on `main`: zero open issues, zero security hotspots left to review, and
    a passed quality gate.
*   **G6. Walkable.** First-person walking with keyboard and mouse at 1.7 m
    eye height. The user cannot walk through buildings or past the edge of
    the area, and starts outside a building, facing the address.
*   **G7. Largest feasible area.** The radius is the largest of 2 km, 1.5 km
    and 1 km that meets all of these on the PoC address:
    *   first load within 60 s;
    *   compressed scene payload at most 3 MB;
    *   scene built in the browser within 1.5 s;
    *   smooth frame rate while walking (no visible stutter on this
        workstation).
*   **G8. Open data, attributed.** Only openly licensed data is used. The
    screen credits OpenStreetMap contributors, Overture Maps Foundation and
    Photon.
*   **G9. Structure.** Domain-Driven Design and Clean Architecture: domain
    rules have no I/O dependencies, and the test command fails if a package
    imports in the wrong direction.

## Non-Goals

*   User accounts, logins and payments.
*   Data sources beyond Overture and Photon: no Overpass, Cesium OSM
    Buildings, Google, terrain or elevation data. The ground is flat.
*   Phones, tablets and touch controls. Desktop browsers with WebGL2 only.
*   Building interiors, multiplayer, navigation or route-finding, and a
    day-night cycle.
*   Refreshing or expiring stored data, and database backups. PostGIS is a
    rebuildable cache of the sources.
*   High availability: one API replica and one PostgreSQL instance.
*   An ingress controller, a job queue, and a metrics, tracing or log
    collection stack.
*   Rust or WebAssembly.

## Open Questions

*   **Q1. Final radius.** G7 is decided by measurements taken during the
    build. Until then the default is 2 km.
*   **Q2. Overture release retention.** How long Overture keeps a release on
    S3 is not yet documented in this design. The pinned release will
    eventually disappear; the error for that case is defined in the
    Technical Plan.
*   **Q3. Photon fair-use terms.** The public instance's usage terms are not
    yet recorded. The design limits calls (debounce, cache), but the terms
    must be checked before the PoC is shown to others.

## Critical User Journeys (CUJs)

### CUJ 1: First visit to an address

*   **Given**: a fresh install with an empty database, and outbound internet
    access from the cluster.
*   **When**: the user types "Av. Bolonha 200" and picks the suggestion in
    Jaguaré, São Paulo.
*   **Then**:
    *   Within 1 s a loading view shows elapsed time and how many tiles are
        stored.
    *   Within 60 s the scene appears.
    *   The camera stands on open ground outside the building at the address,
        facing it, with a marker above it.
    *   Attribution is visible in a corner of the screen.

### CUJ 2: Return visit reads only from storage

*   **Given**: CUJ 1 has completed.
*   **When**: the same address is requested again, including after the API
    and PostgreSQL pods are restarted and with the source URLs pointed at an
    unreachable host.
*   **Then**: the scene appears within a few seconds. The response lists
    every tile as `stored` and reports zero source calls.

### CUJ 3: Walking

*   **Given**: a loaded scene.
*   **When**: the user clicks "Click to walk" and uses W A S D or the arrow
    keys, the mouse, and Shift to run.
*   **Then**:
    *   The camera moves at walking speed, faster with Shift.
    *   Building walls stop the camera.
    *   At the edge of the area the camera stops and a message explains why.
    *   Esc opens a pause screen with Resume, New address, Controls and
        Attribution.

### CUJ 4: A data source fails

*   **Given**: a new area, and Overture's S3 bucket is unreachable.
*   **When**: the user requests the area.
*   **Then**:
    *   The user sees a plain message, a Retry button and a request ID.
    *   The affected tiles are recorded as failed, with the error class.
    *   A retry fetches only the failed tiles.

### CUJ 5: Operator installs on Kind

*   **Given**: a fresh Kind cluster created with the repo's Kind config, and
    images built and loaded with the documented make target.
*   **When**: the operator runs
    `helm install geotoon deploy/helm/geotoon --wait --timeout 5m`.
*   **Then**: all pods are ready within 5 minutes, the chart prints the
    port-forward command, and the app opens in a browser.

