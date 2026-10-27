// Die Teile der Telegram Bot API, die der Bot verwendet.
// https://core.telegram.org/bots/api#available-types

export type TgUser = { id: number; is_bot: boolean; first_name: string; username?: string };

export type TgChat = { id: number; type: string };

export type TgPhotoSize = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
};

export type TgDocument = {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  media_group_id?: string;
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  document?: TgDocument;
};

export type TgCallbackQuery = {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
};

export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
};

export type TgInlineButton = { text: string; callback_data: string };
export type TgInlineKeyboard = { inline_keyboard: TgInlineButton[][] };
