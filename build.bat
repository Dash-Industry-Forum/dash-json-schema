@echo off
set TARGETS=%*
if "%TARGETS%"=="" set TARGETS=spec
docker run --rm -ti -v %cd%:/data -p 8000:8000 dashif/specs-builder:latest -C docs %TARGETS% SRC=dash-json.bs NAME=dash-json
