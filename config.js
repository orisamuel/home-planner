// home-planner: frontend configuration.
// The script URL is public by design. Every call except ping needs the house code,
// which is never stored here or anywhere in this repo.
const CONFIG = {
    SCRIPT_URL: 'https://script.google.com/macros/s/AKfycby1Wrw3YTdt-4PhlStRszpmtIqiN0uAYj__GTti17-b4xZkj8hMLosH08ExAnh6sTg/exec',
    POLL_MS: 20000,          // check for the other phone's changes every 20 seconds
    PHOTO_MAX_PX: 1280,      // photos are shrunk on the phone before upload
};
