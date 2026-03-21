"""Quick test: send a room request through the LLM client and print the result."""

import json
import sys
sys.path.insert(0, ".")

from llm_client import LLMClient

# Sample world state (same as AITestLevel sends)
world_state = {
    "world": {
        "region": "The Ashwood Dungeon, level 2",
        "time_of_day": "eternal_darkness",
        "atmosphere": "ancient, dangerous, forgotten",
        "style_token": "dark fantasy concept art, detailed stone architecture",
    },
    "player": {
        "level": 3,
        "class": "rogue",
        "health": 68,
        "gold": 142,
        "active_quests": ["find_the_missing_merchant"],
        "inventory_summary": "shortsword, lockpicks, 2x health potion",
    },
    "current_room": {
        "visited": False,
        "existing_objects": [],
        "exits": ["north", "east"],
    },
    "story_so_far": "The rogue descends deeper into the dungeon, seeking a merchant who vanished a fortnight ago.",
}

print("Connecting to LLM backend...")
client = LLMClient(timeout=60.0)

print(f"\nSending room request...")
result = client.populate_room(world_state)

print(f"\n{'='*60}")
print(f"Room: {result['room_description']}")
print(f"Objects ({len(result['objects'])}):")
for obj in result["objects"]:
    print(f"  [{obj['mesh']}] {obj['description']}")
    print(f"    pos={obj['spawn_position']} scale={obj['scale']} mood={obj.get('mood', '-')}")
if result.get("npcs"):
    print(f"NPCs ({len(result['npcs'])}):")
    for npc in result["npcs"]:
        print(f"  {npc['name']}: {npc['description']}")
if result.get("ambient_event"):
    print(f"Ambient: {result['ambient_event']}")
print(f"{'='*60}")

print(f"\nFull JSON:\n{json.dumps(result, indent=2)}")
