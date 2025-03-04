const enum PacketType {
  Management = 0,
  Control = 1,
  Data = 2,
}

const enum ManagmentMessageType {
  Associate = 0,
  AssociationSuccess = 1,
  AssociationFailed = 2,
  UnknownError = 3,
}

const enum ControlMessageType {
  Get = 0,
  BufferEmpty = 1,
  PositiveAck = 2,
  BufferFull = 3,
}

const enum DataMessageType {
  GetResponse = 0,
  Push = 1,
}

export abstract class Packet {
  public constructor(protected type: PacketType) {}

  public isManangement(): this is ManagementPacket {
    return this.type === PacketType.Management;
  }

  public isControl(): this is ControlPacket {
    return this.type === PacketType.Control;
  }

  public isData(): this is DataPacket {
    return this.type === PacketType.Data;
  }

  public static decode(buffer: ArrayBuffer): Packet | null {
    const type = new Uint8Array(buffer, 0, 1);

    switch (type[0]) {
      case PacketType.Management:
        return ManagementPacket.decode(buffer);
      case PacketType.Control:
        return ControlPacket.decode(buffer);
      case PacketType.Data:
        return DataPacket.decode(buffer);
    }

    return null;
  }

  public abstract encode(): ArrayBuffer;
}

export class ManagementPacket extends Packet {
  public constructor(private message: ManagmentMessageType, public id: number) {
    super(PacketType.Management);
  }

  public isUnknownError() {
    return this.message === ManagmentMessageType.UnknownError;
  }

  public isAssociationSuccess() {
    return this.message === ManagmentMessageType.AssociationSuccess;
  }

  public isAssociationFailed() {
    return this.message === ManagmentMessageType.AssociationFailed;
  }

  public encode() {
    const buffer = new ArrayBuffer(3);

    const type = new Uint8Array(buffer, 0, 1);
    const message = new Uint8Array(buffer, 1, 1);
    const id = new Uint8Array(buffer, 2, 1);

    type[0] = this.type;
    message[0] = this.message;
    id[0] = this.id;

    return buffer;
  }

  public static associate(clientID: number) {
    return new ManagementPacket(ManagmentMessageType.Associate, clientID);
  }

  public static decode(buffer: ArrayBuffer) {
    const message = new Uint8Array(buffer, 1, 1);
    const id = new Uint8Array(buffer, 2, 1);

    return new ManagementPacket(message[0], id[0]);
  }
}

export class ControlPacket extends Packet {
  public constructor(private message: ControlMessageType, public id: number) {
    super(PacketType.Control);
  }

  public isBufferEmpty() {
    return this.message === ControlMessageType.BufferEmpty;
  }

  public isBufferFull() {
    return this.message === ControlMessageType.BufferFull;
  }

  public isPositiveAck() {
    return this.message === ControlMessageType.PositiveAck;
  }

  public encode() {
    const buffer = new ArrayBuffer(3);

    const type = new Uint8Array(buffer, 0, 1);
    const message = new Uint8Array(buffer, 1, 1);
    const id = new Uint8Array(buffer, 2, 1);

    type[0] = this.type;
    message[0] = this.message;
    id[0] = this.id;

    return buffer;
  }

  public static get(clientID: number) {
    return new ControlPacket(ControlMessageType.Get, clientID);
  }

  public static decode(buffer: ArrayBuffer) {
    const message = new Uint8Array(buffer, 1, 1);
    const id = new Uint8Array(buffer, 2, 1);

    return new ControlPacket(message[0], id[0]);
  }
}

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

export class DataPacket extends Packet {
  public constructor(private message: DataMessageType, public id: number, public id2: number, public payload: string) {
    super(PacketType.Data);
  }

  public isGetResponse() {
    return this.message === DataMessageType.GetResponse;
  }

  public encode() {
    const payload = ENCODER.encode(this.payload);

    const buffer = new ArrayBuffer(5 + payload.byteLength);

    const type = new Uint8Array(buffer, 0, 1);
    const message = new Uint8Array(buffer, 1, 1);
    const id = new Uint8Array(buffer, 2, 1);
    const id2 = new Uint8Array(buffer, 3, 1);
    const length = new Uint8Array(buffer, 4, 1);

    new Uint8Array(buffer, 5, payload.byteLength).set(payload);

    type[0] = this.type;
    message[0] = this.message;
    id[0] = this.id;
    id2[0] = this.id2;
    length[0] = payload.byteLength;

    return buffer;
  }

  public static push(clientID: number, receiverID: number, payload: string) {
    return new DataPacket(DataMessageType.Push, clientID, receiverID, payload);
  }

  public static decode(buffer: ArrayBuffer) {
    const message = new Uint8Array(buffer, 1, 1);
    const id = new Uint8Array(buffer, 2, 1);
    const id2 = new Uint8Array(buffer, 3, 1);
    const length = new Uint8Array(buffer, 4, 1);
    const payload = new Uint8Array(buffer, 5, length[0]);

    return new DataPacket(message[0], id[0], id2[0], DECODER.decode(payload));
  }
}
