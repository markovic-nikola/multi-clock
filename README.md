# Multi-Clock

A Chrome extension for comparing multiple world clocks with your local time. Quickly see what time it is in different cities around the world.

## Features

- Real-time display of current time in multiple cities worldwide
- Time difference relative to your local timezone
- Search and add cities from 100+ supported timezones
- Drag-and-drop reordering of clocks
- 12-hour / 24-hour format toggle
- Dark mode support (follows system preference)
- Cross-device sync via Chrome Storage API

## Installation

1. Clone the repository:
   ```sh
   git clone git@github.com:markovic-nikola/multi-clock.git
   ```
2. Open `chrome://extensions/` in your browser
3. Enable **Developer mode**
4. Click **Load unpacked** and select the project folder

## Tech Stack

- Vanilla JavaScript
- HTML5 / CSS3
- Chrome Extension APIs
- `Intl.DateTimeFormat` for timezone-aware formatting

## Project Structure

```
multi-clock/
├── manifest.json    # Extension configuration
├── popup.html       # Popup UI
├── popup.js         # Application logic
├── styles.css       # Styling and theming
├── timezones.js     # Timezone database (100+ cities)
└── icons/           # Extension icons
```

## License

[MIT](LICENSE)
