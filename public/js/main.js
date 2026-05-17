import './markdown-patch.js';
import { setupAdminPanel } from './admin.js';
import { setupChat } from './chat.js';
import { getChatElements } from './dom.js';
import { setupMemory } from './memory.js';

applyDeviceClass();
setupAdminPanel();
setupMemory();
setupChat(getChatElements());

function applyDeviceClass() {
  const isTouchDevice = window.matchMedia('(hover: none), (pointer: coarse)').matches;
  const isNarrowScreen = window.innerWidth <= 1180;
  const isAndroid = /Android/i.test(navigator.userAgent);

  if (isTouchDevice || isNarrowScreen || isAndroid) {
    document.documentElement.classList.add('force-mobile');
    document.body.classList.add('force-mobile');
  }
}
