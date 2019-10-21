export interface Dependencies {
  mongo?: object;
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
    },
  );

  initDependencies(dependencies?: { withRedis?: boolean; withMongo?: boolean }): Promise<void>;

  run(options: { topics?: string[]; messagesPerConsumption?: number }): Promise<void>;
}
