declare module 'mailparser' {
  export interface AddressValue {
    name?: string;
    address?: string;
  }

  export interface AddressObject {
    value?: AddressValue[];
  }

  export interface Attachment {
    filename?: string;
    contentType?: string;
    size: number;
  }

  export interface ParsedMail {
    messageId?: string | null;
    references?: string | string[] | null;
    inReplyTo?: string | null;
    subject?: string | null;
    from?: AddressObject | null;
    sender?: AddressObject | null;
    replyTo?: AddressObject | null;
    to?: AddressObject | null;
    cc?: AddressObject | null;
    date?: Date | null;
    text?: string | null;
    html?: string | null;
    attachments: Attachment[];
  }

  export function simpleParser(input: Buffer | string): Promise<ParsedMail>;
}
