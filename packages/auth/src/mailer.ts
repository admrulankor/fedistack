import net from "node:net";

export interface MagicLinkEmailMessage {
  to: string;
  magicLinkUrl: string;
  expiresAt: Date;
}

export interface MagicLinkTransport {
  sendMagicLink(message: MagicLinkEmailMessage): Promise<void>;
}

export class InMemoryMagicLinkTransport implements MagicLinkTransport {
  public readonly deliveries: MagicLinkEmailMessage[] = [];

  public async sendMagicLink(message: MagicLinkEmailMessage): Promise<void> {
    this.deliveries.push(message);
  }

  public clear(): void {
    this.deliveries.length = 0;
  }
}

export interface SmtpTransportConfig {
  host: string;
  port: number;
  fromEmail: string;
  fromName?: string;
}

/**
 * Lightweight SMTP transport for dispatching magic link emails to a configured
 * SMTP server (such as Mailpit in local development). Never logs raw magic links.
 */
export class SmtpMagicLinkTransport implements MagicLinkTransport {
  private readonly config: SmtpTransportConfig;

  constructor(config: SmtpTransportConfig) {
    this.config = config;
  }

  public async sendMagicLink(message: MagicLinkEmailMessage): Promise<void> {
    const { host, port, fromEmail, fromName } = this.config;
    const senderHeader = fromName
      ? `"${fromName.replace(/"/g, "")}" <${fromEmail}>`
      : fromEmail;

    const mimeBody = [
      `From: ${senderHeader}`,
      `To: <${message.to}>`,
      `Subject: Sign in to Fedistack`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      `Use the single-use link below to sign in to your Fedistack account:`,
      ``,
      `${message.magicLinkUrl}`,
      ``,
      `This link expires at ${message.expiresAt.toUTCString()}.`,
      `If you did not request this email, you can safely ignore it.`
    ].join("\r\n");

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      let step = 0;
      let buffer = "";

      const commands = [
        `EHLO fedistack.local`,
        `MAIL FROM:<${fromEmail}>`,
        `RCPT TO:<${message.to}>`,
        `DATA`,
        `${mimeBody}\r\n.`,
        `QUIT`
      ];

      socket.setTimeout(5000);

      socket.on("timeout", () => {
        socket.destroy();
        reject(new Error("SMTP connection timed out"));
      });

      socket.on("error", (err) => {
        reject(err);
      });

      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\r\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.length < 4 || line[3] === "-") {
            continue;
          }

          const code = Number.parseInt(line.slice(0, 3), 10);
          if (code >= 400) {
            socket.destroy();
            reject(new Error(`SMTP error response: ${line}`));
            return;
          }

          const nextCmd = commands[step];
          if (nextCmd !== undefined) {
            step += 1;
            socket.write(`${nextCmd}\r\n`);
          } else {
            socket.end();
            resolve();
            return;
          }
        }
      });
    });
  }
}
