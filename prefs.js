'use strict';

/**
 * Preferences for No Screenshot Box.
 *
 * Uses libadwaita widgets in a preferences window provided by GNOME Shell's
 * extensions app.
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class NoScreenshotBoxPreferences extends ExtensionPreferences {
    getPreferencesWidget() {
        const settings = this.getSettings();

        const row = new Adw.SwitchRow({
            title: 'Screenshot on release',
            subtitle: 'Automatically capture the selected area when the drag ends.',
        });

        settings.bind(
            'screenshot-on-release',
            row,
            'active',
            Gio.SettingsBindFlags.DEFAULT);

        const group = new Adw.PreferencesGroup();
        group.add(row);

        const page = new Adw.PreferencesPage({
            title: this.metadata.name,
            icon_name: 'preferences-system-symbolic',
        });
        page.add(group);

        return page;
    }
}
