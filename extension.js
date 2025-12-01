'use strict';

import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

const LOG_PREFIX = 'NoScreenshotBox';

function getShellMajorVersion() {
    const versionString = Config.PACKAGE_VERSION ?? '';
    const [major] = versionString.split('.');
    const parsed = Number.parseInt(major, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
}

class NoScreenshotBoxController {
    constructor() {
        this._areaSelector = null;
        this._originalReset = null;
        this._dragStartedId = 0;
        this._retryId = 0;
        this._selectionRectOpacity = null;
        this._handleOpacities = new Map();
        this._attemptCount = 0;
        this._shellMajor = getShellMajorVersion();
    }

    enable() {
        this.disable();
        this._attemptCount = 0;
        this._log(`Detected GNOME Shell ${this._shellMajor}`);
        this._patchWhenReady();
    }

    disable() {
        if (this._retryId) {
            GLib.source_remove(this._retryId);
            this._retryId = 0;
        }

        this._restore();
    }

    _log(message) {
        log(`${LOG_PREFIX}: ${message}`);
    }

    _patchWhenReady() {
        const maxAttempts = 20;
        const attempt = () => {
            this._attemptCount++;

            const areaSelector = this._findAreaSelector();
            if (!areaSelector) {
                if (this._attemptCount === 1)
                    this._log('Screenshot UI not ready; will retry shortly');

                if (this._attemptCount >= maxAttempts) {
                    this._log('Unable to find screenshot selection actor; extension will stay inactive');
                    return true;
                }

                return false;
            }

            this._applyPatch(areaSelector);
            return true;
        };

        if (attempt())
            return;

        this._retryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            if (attempt()) {
                this._retryId = 0;
                return GLib.SOURCE_REMOVE;
            }

            return GLib.SOURCE_CONTINUE;
        });
    }

    _applyPatch(areaSelector) {
        this._restore();
        this._areaSelector = areaSelector;

        if (typeof areaSelector.reset === 'function') {
            this._originalReset = areaSelector.reset.bind(areaSelector);
            areaSelector.reset = (...args) => {
                const result = this._originalReset(...args);
                this._clearSelection(areaSelector);
                return result;
            };
        } else {
            this._log('Area selector has no reset(); clearing selection directly');
        }

        // Show the rectangle only after the user actively starts a drag.
        if (typeof areaSelector.connect === 'function') {
            try {
                this._dragStartedId = areaSelector.connect('drag-started',
                    () => this._revealSelection(areaSelector));
            } catch (error) {
                this._log(`Failed to connect drag-started signal: ${error}`);
            }
        }

        this._clearSelection(areaSelector);
        this._log('Patched screenshot selection reset');
    }

    _restore() {
        if (!this._areaSelector)
            return;

        const areaSelector = this._areaSelector;

        if (this._dragStartedId)
            areaSelector.disconnect(this._dragStartedId);
        this._dragStartedId = 0;

        if (this._originalReset)
            areaSelector.reset = this._originalReset;
        this._originalReset = null;

        const selectionRect = this._getSelectionRect(areaSelector);
        if (selectionRect && this._selectionRectOpacity !== null)
            selectionRect.opacity = this._selectionRectOpacity;
        this._selectionRectOpacity = null;

        for (const [name, actor] of this._getHandles(areaSelector)) {
            const original = this._handleOpacities.get(name);
            if (actor && original !== undefined)
                actor.opacity = original;
        }
        this._handleOpacities.clear();

        this._areaSelector = null;
    }

    _findAreaSelector() {
        const screenshotUI = Main?.screenshotUI;
        if (!screenshotUI)
            return null;

        const direct = [
            screenshotUI._areaSelector,
            screenshotUI._areaSelection,
            screenshotUI._selectionArea,
            screenshotUI._selection,
        ].find(selector => selector);
        if (direct)
            return direct;

        // Fallback: pick the first object that looks like the selector.
        for (const key of Object.keys(screenshotUI)) {
            const candidate = screenshotUI[key];
            if (candidate &&
                typeof candidate.reset === 'function' &&
                typeof candidate.getGeometry === 'function' &&
                typeof candidate.connect === 'function')
                return candidate;
        }

        return null;
    }

    _clearSelection(areaSelector) {
        if ('_startX' in areaSelector)
            areaSelector._startX = 0;
        if ('_startY' in areaSelector)
            areaSelector._startY = 0;
        if ('_lastX' in areaSelector)
            areaSelector._lastX = 0;
        if ('_lastY' in areaSelector)
            areaSelector._lastY = 0;

        if (typeof areaSelector._updateSelectionRect === 'function')
            areaSelector._updateSelectionRect();

        for (const [name, actor] of this._getHandles(areaSelector)) {
            if (!actor)
                continue;

            if (!this._handleOpacities.has(name))
                this._handleOpacities.set(name, actor.opacity);

            actor.opacity = 0;
        }

        const selectionRect = this._getSelectionRect(areaSelector);
        if (selectionRect) {
            if (this._selectionRectOpacity === null)
                this._selectionRectOpacity = selectionRect.opacity;

            selectionRect.opacity = 0;
        }
    }

    _revealSelection(areaSelector) {
        const selectionRect = this._getSelectionRect(areaSelector);
        if (selectionRect && this._selectionRectOpacity !== null)
            selectionRect.opacity = this._selectionRectOpacity;

        for (const [name, actor] of this._getHandles(areaSelector)) {
            if (!actor)
                continue;

            const saved = this._handleOpacities.get(name);
            actor.opacity = saved !== undefined ? saved : 255;
        }
    }

    _getSelectionRect(areaSelector) {
        if (areaSelector._selectionRect)
            return areaSelector._selectionRect;

        if (areaSelector._areaIndicator?.['_selectionRect'])
            return areaSelector._areaIndicator._selectionRect;

        return null;
    }

    _getHandles(areaSelector) {
        const names = [
            '_topLeftHandle',
            '_topRightHandle',
            '_bottomLeftHandle',
            '_bottomRightHandle',
        ];

        return names.map(name => [name, areaSelector[name]]);
    }
}

export default class NoScreenshotBoxExtension {
    constructor(metadata) {
        this._metadata = metadata;
        this._impl = new NoScreenshotBoxController();
    }

    enable() {
        this._impl.enable();
    }

    disable() {
        this._impl.disable();
    }
}
