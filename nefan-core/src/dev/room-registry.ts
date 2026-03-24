/** Registry of all available rooms. Single source of truth for both frontends. */

export interface RoomEntry {
  id: string;
  file: string;
  category: "game" | "style" | "dev";
  description: string;
}

export const ROOMS: RoomEntry[] = [
  // Game rooms
  { id: "crypt_001", file: "crypt_001.json", category: "game", description: "Crypt with skeleton enemy" },
  { id: "tavern_001", file: "tavern_001.json", category: "game", description: "Tavern with exits" },
  { id: "corridor_001", file: "corridor_001.json", category: "game", description: "Narrow corridor" },

  // Art style test rooms
  { id: "style_anime", file: "style_anime.json", category: "style", description: "Anime cel-shaded" },
  { id: "style_pixel", file: "style_pixel.json", category: "style", description: "Pixel art retro" },
  { id: "style_classic", file: "style_classic.json", category: "style", description: "Classic RPG oil" },
  { id: "style_realistic", file: "style_realistic.json", category: "style", description: "Photorealistic PBR" },
  { id: "style_watercolor", file: "style_watercolor.json", category: "style", description: "Watercolor" },
  { id: "style_darksouls", file: "style_darksouls.json", category: "style", description: "Dark Souls gritty" },

  // Dev test rooms
  { id: "anim_showcase", file: "dev/anim_showcase.json", category: "dev", description: "Animation comparison" },
  { id: "root_motion_debug", file: "dev/root_motion_debug.json", category: "dev", description: "Root motion debug (grid floor)" },
];

export function getRooms(): RoomEntry[] {
  return ROOMS;
}

export function getRoomsByCategory(category: RoomEntry["category"]): RoomEntry[] {
  return ROOMS.filter((r) => r.category === category);
}

export function getRoomEntry(id: string): RoomEntry | undefined {
  return ROOMS.find((r) => r.id === id);
}
