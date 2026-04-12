// ========================
// RabbitMQ Connection: Singleton quản lý kết nối
// Tất cả publisher/subscriber đều dùng chung connection này
// ========================
import amqplib, { Channel } from 'amqplib';

/** Type chính xác mà amqplib.connect() trả về (ChannelModel trong v0.10.x) */
type AmqpConnection = Awaited<ReturnType<typeof amqplib.connect>>;

class RabbitMQConnection {
  private static instance: RabbitMQConnection;
  private connection: AmqpConnection | null = null;
  private channel: Channel | null = null;
  private isConnecting = false;
  private url: string = '';

  private constructor() {}

  /** Lấy instance duy nhất (Singleton Pattern) */
  static getInstance(): RabbitMQConnection { // sử dụng static để chỉ có 1 instance duy nhất
    if (!RabbitMQConnection.instance) {
      RabbitMQConnection.instance = new RabbitMQConnection();
    }
    return RabbitMQConnection.instance;
  }

  /**
   * Kết nối tới RabbitMQ server.
   * Tự động retry nếu server chưa sẵn sàng.
   */
  async connect(url: string, retries = 5, retryDelay = 5000): Promise<void> {
    if (this.connection) return;
    if (this.isConnecting) return;

    this.isConnecting = true;
    this.url = url;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`[RabbitMQ] Đang kết nối (lần ${attempt})...`);
        this.connection = await amqplib.connect(url);
        this.channel = await this.connection.createChannel();

        // Xử lý khi mất kết nối
        this.connection.on('error', (err) => {
          console.error('[RabbitMQ] Connection error:', err.message);
          this.connection = null;
          this.channel = null;
        });

        this.connection.on('close', () => {
          console.warn('[RabbitMQ] Connection closed. Sẽ reconnect...');
          this.connection = null;
          this.channel = null;
          setTimeout(() => this.connect(this.url), 5000);
        });

        console.log('[RabbitMQ] Kết nối thành công!');
        this.isConnecting = false;
        return;
      } catch (error: any) {
        console.error(`[RabbitMQ] Kết nối thất bại (lần ${attempt}): ${error.message}`);
        if (attempt < retries) {
          console.log(`[RabbitMQ] Retry sau ${retryDelay / 1000}s...`);
          await this.sleep(retryDelay);
        }
      }
    }

    this.isConnecting = false;
    throw new Error(`[RabbitMQ] Không thể kết nối sau ${retries} lần thử.`);
  }

  /** Lấy channel hiện tại (dùng bởi publisher/subscriber) */
  getChannel(): Channel {
    if (!this.channel) {
      throw new Error('[RabbitMQ] Chưa kết nối. Gọi connect() trước.');
    }
    return this.channel;
  }

  /** Kiểm tra trạng thái kết nối */
  isConnected(): boolean {
    return this.connection !== null && this.channel !== null;
  }

  /** Đóng kết nối sạch sẽ (dùng khi shutdown gracefully) */
  async close(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
      this.channel = null;
      this.connection = null;
      console.log('[RabbitMQ] Đã đóng kết nối.');
    } catch (error) {
      console.error('[RabbitMQ] Lỗi khi đóng kết nối:', error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default RabbitMQConnection;
