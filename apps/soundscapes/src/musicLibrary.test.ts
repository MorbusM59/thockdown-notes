import { describe, expect, it } from 'vitest';
import { chooseSong, nextSong, poolOf, type MusicCatalog } from './musicLibrary';

function song(id: number, setIds: number[], title = `Song ${id}`) {
  return { id, filePath: `content://music/${id}`, setIds, title, artist: '', album: '', durationSec: 0 };
}

const catalog: MusicCatalog = {
  songs: [song(1, [1]), song(2, [1]), song(3, [2]), song(4, [1, 2], 'Blue')],
  activeSetIds: [1],
  filter: { query: '' },
};

describe('the Android music library', () => {
  it('pools the active sets, filtered, new songs first', () => {
    expect(poolOf(catalog, []).map((entry) => entry.id)).toEqual([1, 2, 4]);
    expect(poolOf({ ...catalog, filter: { query: 'blue' } }, []).map((entry) => entry.id)).toEqual([4]);
    expect(poolOf(catalog, [{ id: 1, priority: 5, favorability: 1 }]).map((entry) => entry.id)).toEqual([2, 4, 1]);
  });

  it('plays through the pool without repeating until every song has played', () => {
    let rotation = poolOf(catalog, []).map(({ id, priority, favorability }) => ({ id, priority, favorability }));
    let previous: number | null = null;
    const played: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const next = nextSong(catalog, rotation, previous, () => 0);
      rotation = next.rotation;
      previous = next.song!.id;
      played.push(previous);
    }
    expect(new Set(played).size).toBe(3);
  });

  it('makes a chosen song the next pick', () => {
    const rotation = chooseSong(catalog, [], 4);
    expect(nextSong(catalog, rotation, null, () => 0.99).song?.id).toBe(4);
  });
});
