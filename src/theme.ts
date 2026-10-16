import type { ITheme } from '@xterm/xterm';
import type { Theme } from './model';

export const terminalThemes: Record<Theme, ITheme> = {
  light: { background: '#000000', foreground: '#dedede', cursor: '#b7d3b0', cursorAccent: '#000000', selectionBackground: '#31516c', selectionForeground: '#ffffff', selectionInactiveBackground: '#283d50', black: '#000000', red: '#e87575', green: '#75cc83', yellow: '#e7cf74', blue: '#7aade5', magenta: '#c994df', cyan: '#73ced7', white: '#ededed', brightBlack: '#808080', brightRed: '#ff9292', brightGreen: '#96e6a2', brightYellow: '#ffe794', brightBlue: '#a0c8ff', brightMagenta: '#e6b3ff', brightCyan: '#9cebf2', brightWhite: '#ffffff' },
  dark: { background: '#11151c', foreground: '#dce5ef', cursor: '#80c7ff', cursorAccent: '#11151c', selectionBackground: '#365779', selectionForeground: '#ffffff', selectionInactiveBackground: '#293e55', black: '#11151c', red: '#f08087', green: '#8cce9a', yellow: '#e9cb87', blue: '#89b8f8', magenta: '#cea0eb', cyan: '#85d5dc', white: '#dce5ef', brightBlack: '#8b98aa', brightRed: '#ffa1a6', brightGreen: '#a6e9b4', brightYellow: '#ffe6a6', brightBlue: '#acd0ff', brightMagenta: '#e7beff', brightCyan: '#a5eef3', brightWhite: '#ffffff' }
};
