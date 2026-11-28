package com.thockdown.soundscapes;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * What a media browser (Android Auto) lists from the music catalog
 * (musicLibrary.ts's MusicCatalog as JSON): the sets that hold songs, in
 * display order, which of them play, and the filter with its recent
 * queries. A READING only: every change to the catalog is made by the
 * page's own rules (the page, or musicSandbox.ts's musicEditCatalog).
 */
final class LibraryView {
    static final class SetRow {
        final int id;
        final String name;
        final boolean active;

        SetRow(int id, String name, boolean active) {
            this.id = id;
            this.name = name;
            this.active = active;
        }
    }

    final List<SetRow> sets = new ArrayList<>();
    final List<String> recentFilters = new ArrayList<>();
    String filterQuery = "";
    boolean filterOn = false;

    static LibraryView of(String catalogJson) {
        LibraryView view = new LibraryView();
        try {
            JSONObject catalog = new JSONObject(catalogJson);
            java.util.Set<Integer> held = new HashSet<>();
            JSONArray songs = catalog.optJSONArray("songs");
            for (int i = 0; songs != null && i < songs.length(); i++) {
                JSONArray setIds = songs.getJSONObject(i).optJSONArray("setIds");
                for (int j = 0; setIds != null && j < setIds.length(); j++) held.add(setIds.getInt(j));
            }
            java.util.Set<Integer> active = new HashSet<>();
            JSONArray activeIds = catalog.optJSONArray("activeSetIds");
            for (int i = 0; activeIds != null && i < activeIds.length(); i++) active.add(activeIds.getInt(i));
            JSONArray sets = catalog.optJSONArray("sets");
            for (int i = 0; sets != null && i < sets.length(); i++) {
                JSONObject set = sets.getJSONObject(i);
                int id = set.getInt("slot");
                // An empty set cannot play, as the page's set buttons say.
                if (held.contains(id)) view.sets.add(new SetRow(id, set.optString("name", ""), active.contains(id)));
            }
            JSONObject filter = catalog.optJSONObject("filter");
            if (filter != null) {
                view.filterQuery = filter.optString("query", "").trim();
                view.filterOn = filter.optBoolean("enabled", false) && !view.filterQuery.isEmpty();
            }
            JSONArray recent = catalog.optJSONArray("recentFilters");
            for (int i = 0; recent != null && i < recent.length(); i++) view.recentFilters.add(recent.getString(i));
        } catch (org.json.JSONException ignored) {
            // The page wrote it; an unreadable catalog lists nothing.
        }
        return view;
    }
}
