/*
Copyright 2020 Bruno Windels <bruno@windels.cloud>
Copyright 2020 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import {removeRoomFromPath} from "../navigation/index.js";
import {LeftPanelViewModel} from "./leftpanel/LeftPanelViewModel.js";
import {RoomViewModel} from "./room/RoomViewModel.js";
import {InviteViewModel} from "./room/InviteViewModel.js";
import {LightboxViewModel} from "./room/LightboxViewModel.js";
import {SessionStatusViewModel} from "./SessionStatusViewModel.js";
import {RoomGridViewModel} from "./RoomGridViewModel.js";
import {SettingsViewModel} from "./settings/SettingsViewModel.js";
import {ViewModel} from "../ViewModel.js";

export class SessionViewModel extends ViewModel {
    constructor(options) {
        super(options);
        const {sessionContainer} = options;
        this._sessionContainer = this.track(sessionContainer);
        this._sessionStatusViewModel = this.track(new SessionStatusViewModel(this.childOptions({
            sync: sessionContainer.sync,
            reconnector: sessionContainer.reconnector,
            session: sessionContainer.session,
        })));
        this._leftPanelViewModel = this.track(new LeftPanelViewModel(this.childOptions({
            invites: this._sessionContainer.session.invites,
            rooms: this._sessionContainer.session.rooms
        })));
        this._settingsViewModel = null;
        this._currentRoomViewModel = null;
        this._gridViewModel = null;
        this._refreshRoomViewModel = this._refreshRoomViewModel.bind(this);
        this._createRoomViewModel = this._createRoomViewModel.bind(this);
        this._setupNavigation();
    }

    _setupNavigation() {
        const gridRooms = this.navigation.observe("rooms");
        // this gives us a set of room ids in the grid
        this.track(gridRooms.subscribe(roomIds => {
            this._updateGrid(roomIds);
        }));
        if (gridRooms.get()) {
            this._updateGrid(gridRooms.get());
        }

        const currentRoomId = this.navigation.observe("room");
        // this gives us the active room
        this.track(currentRoomId.subscribe(roomId => {
            if (!this._gridViewModel) {
                this._updateRoom(roomId);
            }
        }));
        if (!this._gridViewModel) {
            this._updateRoom(currentRoomId.get());
        }

        const settings = this.navigation.observe("settings");
        this.track(settings.subscribe(settingsOpen => {
            this._updateSettings(settingsOpen);
        }));
        this._updateSettings(settings.get());

        const lightbox = this.navigation.observe("lightbox");
        this.track(lightbox.subscribe(eventId => {
            this._updateLightbox(eventId);
        }));
        this._updateLightbox(lightbox.get());
    }

    get id() {
        return this._sessionContainer.sessionId;
    }

    start() {
        this._sessionStatusViewModel.start();
    }

    get activeMiddleViewModel() {
        return this._currentRoomViewModel || this._gridViewModel || this._settingsViewModel;
    }

    get roomGridViewModel() {
        return this._gridViewModel;
    }

    get leftPanelViewModel() {
        return this._leftPanelViewModel;
    }

    get sessionStatusViewModel() {
        return this._sessionStatusViewModel;
    }

    get settingsViewModel() {
        return this._settingsViewModel;
    }

    get currentRoomViewModel() {
        return this._currentRoomViewModel;
    }

    _updateGrid(roomIds) {
        const changed = !(this._gridViewModel && roomIds);
        const currentRoomId = this.navigation.path.get("room");
        if (roomIds) {
            if (!this._gridViewModel) {
                this._gridViewModel = this.track(new RoomGridViewModel(this.childOptions({
                    width: 3,
                    height: 2,
                    createRoomViewModel: this._createRoomViewModel,
                })));
                if (this._gridViewModel.initializeRoomIdsAndTransferVM(roomIds, this._currentRoomViewModel)) {
                    this._currentRoomViewModel = this.untrack(this._currentRoomViewModel);
                } else if (this._currentRoomViewModel) {
                    this._currentRoomViewModel = this.disposeTracked(this._currentRoomViewModel);
                }
            } else {
                this._gridViewModel.setRoomIds(roomIds);
            }
        } else if (this._gridViewModel && !roomIds) {
            // closing grid, try to show focused room in grid
            if (currentRoomId) {
                const vm = this._gridViewModel.releaseRoomViewModel(currentRoomId.value);
                if (vm) {
                    this._currentRoomViewModel = this.track(vm);
                } else {
                    const newVM = this._createRoomViewModel(currentRoomId.value, this._refreshRoomViewModel);
                    if (newVM) {
                        this._currentRoomViewModel = this.track(newVM);
                    }
                }
            }
            this._gridViewModel = this.disposeTracked(this._gridViewModel);
        }
        if (changed) {
            this.emitChange("activeMiddleViewModel");
        }
    }

    /**
     * @param  {string} roomId
     * @param  {function} refreshRoomViewModel passed in as an argument, because the grid needs a different impl of this
     * @return {RoomViewModel | InviteViewModel}
     */
    _createRoomViewModel(roomId, refreshRoomViewModel) {
        const invite = this._sessionContainer.session.invites.get(roomId);
        if (invite) {
            return new InviteViewModel(this.childOptions({
                invite,
                mediaRepository: this._sessionContainer.session.mediaRepository,
                refreshRoomViewModel,
            }));
        } else {
            const room = this._sessionContainer.session.rooms.get(roomId);
            if (room) {
                const roomVM = new RoomViewModel(this.childOptions({
                    room,
                    ownUserId: this._sessionContainer.session.user.id,
                    refreshRoomViewModel
                }));
                roomVM.load();
                return roomVM;
            }
        }
        return null;
    }

    /** refresh the room view model after an internal change that needs
    to change between invite, room or none state */
    _refreshRoomViewModel(roomId) {
        this._currentRoomViewModel = this.disposeTracked(this._currentRoomViewModel);
        const roomVM = this._createRoomViewModel(roomId, this._refreshRoomViewModel);
        if (roomVM) {
            this._currentRoomViewModel = this.track(roomVM);
        } else {
            // close room id
            this.navigation.applyPath(removeRoomFromPath(this.navigation.path, roomId));
        }
        this.emitChange("activeMiddleViewModel");
    }

    _updateRoom(roomId) {
        // opening a room and already open?
        if (this._currentRoomViewModel?.id === roomId) {
            return;
        }
        // close if needed
        if (this._currentRoomViewModel) {
            this._currentRoomViewModel = this.disposeTracked(this._currentRoomViewModel);
        }
        // and try opening again
        const roomVM = this._createRoomViewModel(roomId, this._refreshRoomViewModel);
        if (roomVM) {
            this._currentRoomViewModel = this.track(roomVM);
        }
        this.emitChange("activeMiddleViewModel");
    }

    _updateSettings(settingsOpen) {
        if (this._settingsViewModel) {
            this._settingsViewModel = this.disposeTracked(this._settingsViewModel);
        }
        if (settingsOpen) {
            this._settingsViewModel = this.track(new SettingsViewModel(this.childOptions({
                session: this._sessionContainer.session,
            })));
            this._settingsViewModel.load();
        }
        this.emitChange("activeMiddleViewModel");
    }

    _updateLightbox(eventId) {
        if (this._lightboxViewModel) {
            this._lightboxViewModel = this.disposeTracked(this._lightboxViewModel);
        }
        if (eventId) {
            const roomId = this.navigation.path.get("room").value;
            const room = this._sessionContainer.session.rooms.get(roomId);
            this._lightboxViewModel = this.track(new LightboxViewModel(this.childOptions({eventId, room})));
        }
        this.emitChange("lightboxViewModel");
    }

    get lightboxViewModel() {
        return this._lightboxViewModel;
    }
}
