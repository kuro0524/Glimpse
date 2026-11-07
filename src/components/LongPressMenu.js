// 長押しメニューの共通部品。
// menu = { title?, actions: [{ id, title, destructive }], onAction: (id) => void }
// 長押しでiOS純正のアクションシートを出す。
// （@react-native-menu/menu はタップを横取りして写真やアルバムが開けなくなるため使わない）
import { ActionSheetIOS } from 'react-native';

export function openMenu(menu) {
  if (!menu || menu.actions.length === 0) return;
  const options = [...menu.actions.map(a => a.title), 'キャンセル'];
  const destructiveButtonIndex = menu.actions
    .map((a, i) => (a.destructive ? i : -1))
    .filter(i => i >= 0);
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: menu.title,
      options,
      cancelButtonIndex: options.length - 1,
      destructiveButtonIndex,
      userInterfaceStyle: 'dark',
    },
    (index) => {
      if (index < menu.actions.length) menu.onAction(menu.actions[index].id);
    }
  );
}

// 以前の書き方との互換用。中身をそのまま表示するだけ
export default function LongPressMenu({ children }) {
  return children;
}
