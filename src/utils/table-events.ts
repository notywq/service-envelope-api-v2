import { Request, Response } from 'express';

export type TableResource = 'requests' | 'services';
export type TableEventName = 'created' | 'updated' | 'deleted' | 'changed';

export interface TableEventPayload {
  resource: TableResource;
  event: TableEventName;
  version: string;
  ids: string[];
}

const clients = new Set<Response>();
let versionSequence = 0;
const versions: Record<TableResource, string> = {
  requests: createVersion('requests'),
  services: createVersion('services'),
};

function createVersion(resource: TableResource): string {
  versionSequence += 1;
  return `${resource}:${Date.now()}:${versionSequence}`;
}

function writeEvent(res: Response, payload: TableEventPayload): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function getTableVersion(resource: TableResource): string {
  return versions[resource];
}

export function publishTableEvent(event: {
  resource: TableResource;
  event: TableEventName;
  ids?: string[];
}): TableEventPayload {
  versions[event.resource] = createVersion(event.resource);

  const payload: TableEventPayload = {
    resource: event.resource,
    event: event.event,
    version: versions[event.resource],
    ids: event.ids ?? [],
  };

  for (const client of clients) {
    writeEvent(client, payload);
  }

  return payload;
}

export function tableEventsHandler(_req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  clients.add(res);
  res.write(': connected\n\n');

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 25000);

  res.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
}
