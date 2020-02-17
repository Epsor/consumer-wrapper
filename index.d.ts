import Mongo from '@epsor/mongodb-wrapper';

export interface Dependencies {
  mongo?: Mongo;
  redis?: object;
}

export abstract class AbstractHandler {
  handlerName(): string;

  allowedTypes(): string[];

  handle(dependencies: Dependencies, dto: object);
}

export class Consumer {
  constructor(
    type: string,
    handlers: object[],
    dependencies: Dependencies,
    kafkaCredentials: {
      kafkaHost?: string;
      kafkaUsername?: string;
      kafkaPassword?: string;
      autoCommit?: boolean;
      parallelConsumption?: boolean;
    },
    groupId?: string,
  );

  initDependencies(dependencies?: { redis?: boolean; mongo?: boolean }): Promise<void>;

  run(options: { topics?: string[]; messagesPerConsumption?: number }): Promise<void>;
}
