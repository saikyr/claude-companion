#!/usr/bin/env python3
"""Export QuestieDB's Forever database to JSON, using QuestieDB's own loader and correction registry.

  python3 -I export_questie.py <questiedb checkout> <out dir>

Writes questie_{quest,npc,item,object}.json: the full Forever data (raw base + every static
correction layer, exactly what Questie loads in game), and questie_era_*.json: the same with only
the inherited Classic-era layers. The difference between the two tells the build which facts came
from Forever-specific data (Wowhead Forever snapshot, QuestieTrace player traces, Forever fixes).

QuestieDB's Lua runs in a sandboxed Lua 5.1 (lupa): file writes, os.execute and io.popen are refused.
"""
import json, os, sys
import lupa.lua51 as L

repo, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
os.makedirs(out, exist_ok=True)
os.chdir(repo)


def runtime():
    lua = L.LuaRuntime(unpack_returned_tuples=True)
    lua.execute(r'''
    local real_open = io.open
    io.open = function(p, mode)
      mode = mode or "r"
      if mode:find("[wa+]") then return nil, "writes disabled in sandbox" end
      return real_open(p, mode)
    end
    io.popen = function() error("popen disabled in sandbox") end
    os.execute = function() error("execute disabled in sandbox") end
    os.remove = nil; os.rename = nil
    ''')
    return lua


LOAD = r'''
local eraOnly = ...
local config = dofile("src/config.lua")
local flavor = config.flavorByName.Forever
local loaded = dofile("generator/flavor.lua").load(flavor, nil, false)
local runtime = dofile("generator/runtime.lua")
local db = runtime.build()
if eraOnly then
  local keep = {}
  for _, spec in ipairs(db.CorrectionManifest) do
    if not spec.file:match("^Forever/") or spec.file:match("^Forever/legacy/") then keep[#keep + 1] = spec end
  end
  db.CorrectionManifest = keep
end
runtime.loadCorrections(db, flavor)
for _, entityType in ipairs(config.entityTypes) do
  db.Corrections.ApplyStaticToEntities(entityType.name, loaded[entityType.name].entities, flavor, db.Corrections.OWNER)
end
local names = {}
for _, entityType in ipairs(config.entityTypes) do names[#names + 1] = entityType.name end
return loaded, names
'''


def py(v):
    if L.lua_type(v) == 'table':
        keys = list(v.keys())
        if keys and all(isinstance(k, int) and k >= 1 for k in keys) and max(keys) <= 4 * len(keys) + 8:
            return [py(v[i]) if i in keys else None for i in range(1, max(keys) + 1)]
        return {str(k): py(v[k]) for k in keys}
    return v


counts = {}
for prefix, era in (('questie_', False), ('questie_era_', True)):
    lua = runtime()
    loaded, names = lua.execute(LOAD, era)
    for name in names.values():
        ents = loaded[name].entities
        d = {str(k): py(ents[k]) for k in ents.keys()}
        counts[prefix + name.lower()] = len(d)
        with open(os.path.join(out, f'{prefix}{name.lower()}.json'), 'w') as f:
            json.dump(d, f, separators=(',', ':'))

# provenance: which QuestieDB commit this came from
head = open('.git/HEAD').read().strip()
if head.startswith('ref:'):
    ref = head.split(' ', 1)[1]
    p = os.path.join('.git', ref)
    head = open(p).read().strip() if os.path.exists(p) else next(
        (l.split()[0] for l in open('.git/packed-refs') if l.strip().endswith(ref)), head)
counts['questiedb_commit'] = head
json.dump(counts, open(os.path.join(out, 'questie_manifest.json'), 'w'), indent=1)
print(json.dumps(counts))
