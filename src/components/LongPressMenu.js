// 長押しでiOS純正のメニューを出すための共通部品。
// menu = { actions: [{ id, title, image, destructive }], onAction: (id) => void }
// menu が null のときは何もせず、中身をそのまま表示する（選択モード中など）。
import React from 'react';
import { MenuView } from '@react-native-menu/menu';

export default function LongPressMenu({ menu, style, children }) {
  if (!menu || menu.actions.length === 0) return children;
  const actions = menu.actions.map(a => ({
    id: a.id,
    title: a.title,
    image: a.image,
    attributes: a.destructive ? { destructive: true } : undefined,
  }));
  return (
    <MenuView
      style={style}
      shouldOpenOnLongPress
      themeVariant="dark"
      actions={actions}
      onPressAction={({ nativeEvent }) => menu.onAction(nativeEvent.event)}
    >
      {children}
    </MenuView>
  );
}
