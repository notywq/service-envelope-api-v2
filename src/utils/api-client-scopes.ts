export interface ApiClientScopeDefinition {
  scope: string;
  label: string;
  description: string;
  endpoints: string[];
}

export interface ApiClientScopeGroup {
  id: string;
  label: string;
  description: string;
  scopes: ApiClientScopeDefinition[];
}

export const API_CLIENT_SCOPE_GROUPS: ApiClientScopeGroup[] = [
  {
    id: 'services',
    label: 'Services',
    description: 'Read or manage published service definitions.',
    scopes: [
      {
        scope: 'services:read',
        label: 'Read services',
        description: 'List and inspect service definitions.',
        endpoints: ['GET /api/services', 'GET /api/services/ids', 'GET /api/services/:serviceId'],
      },
      {
        scope: 'services:delete',
        label: 'Delete services',
        description: 'Delete a service definition through the non-admin services route.',
        endpoints: ['DELETE /api/services/:serviceId'],
      },
    ],
  },
  {
    id: 'requests',
    label: 'Requests',
    description: 'Create, inspect, resume, or cancel service requests.',
    scopes: [
      {
        scope: 'requests:create',
        label: 'Create requests',
        description: 'Submit new service requests.',
        endpoints: ['POST /api/requests'],
      },
      {
        scope: 'requests:list',
        label: 'List requests',
        description: 'List requests with pagination and filters.',
        endpoints: ['GET /api/requests'],
      },
      {
        scope: 'requests:read',
        label: 'Read requests',
        description: 'Read request details.',
        endpoints: ['GET /api/requests/:requestId'],
      },
      {
        scope: 'requests:history',
        label: 'Read request history',
        description: 'Read request timeline/history entries.',
        endpoints: ['GET /api/requests/:requestId/history'],
      },
      {
        scope: 'requests:resume',
        label: 'Resume requests',
        description: 'Resume a paused request workflow.',
        endpoints: ['POST /api/requests/:requestId/resume'],
      },
      {
        scope: 'requests:cancel',
        label: 'Cancel requests',
        description: 'Cancel a request through the API.',
        endpoints: ['DELETE /api/requests/:requestId'],
      },
    ],
  },
  {
    id: 'delivery',
    label: 'Delivery',
    description: 'Submit delivery choices and inspect or update delivery status.',
    scopes: [
      {
        scope: 'delivery:read',
        label: 'Read delivery',
        description: 'Read delivery details, selected method, and status.',
        endpoints: ['GET /api/delivery/:requestId', 'GET /api/delivery/:requestId/method'],
      },
      {
        scope: 'delivery:update',
        label: 'Update delivery',
        description: 'Submit delivery details or method selection.',
        endpoints: ['POST /api/delivery/:requestId/details', 'POST /api/delivery/:requestId/method'],
      },
      {
        scope: 'delivery-status:read',
        label: 'Read delivery status',
        description: 'Read delivery status history and current status.',
        endpoints: ['GET /api/delivery-status/:requestId/history', 'GET /api/delivery-status/:requestId/current'],
      },
      {
        scope: 'delivery-status:update',
        label: 'Update delivery status',
        description: 'Post operational delivery status updates.',
        endpoints: ['POST /api/delivery-status/:requestId'],
      },
    ],
  },
  {
    id: 'payments',
    label: 'Payments',
    description: 'Report external payment outcomes and payment gateway callbacks.',
    scopes: [
      {
        scope: 'payments:complete',
        label: 'Complete payments',
        description: 'Mark a request payment as completed.',
        endpoints: ['POST /api/payments/:requestId/complete', 'POST /api/webhooks/:requestId/complete'],
      },
      {
        scope: 'payments:fail',
        label: 'Fail payments',
        description: 'Mark a request payment as failed.',
        endpoints: ['POST /api/payments/:requestId/failed', 'POST /api/webhooks/:requestId/failed'],
      },
      {
        scope: 'payments:webhook',
        label: 'Receive payment webhooks',
        description: 'Submit payment provider webhook events.',
        endpoints: ['POST /api/webhooks/maya', 'POST /api/payments/maya'],
      },
    ],
  },
  {
    id: 'approvals',
    label: 'Approvals',
    description: 'Read approval-token state or submit approval decisions.',
    scopes: [
      {
        scope: 'approvals:read',
        label: 'Read approvals',
        description: 'Read approval token status or approval request details.',
        endpoints: ['GET /api/approvals/:token', 'GET /api/approvals/:token/request'],
      },
      {
        scope: 'approvals:submit',
        label: 'Submit approvals',
        description: 'Approve or deny an approval token.',
        endpoints: ['POST /api/approvals/:token/approve', 'POST /api/approvals/:token/deny'],
      },
    ],
  },
  {
    id: 'feedback',
    label: 'Feedback',
    description: 'Read or submit feedback data.',
    scopes: [
      {
        scope: 'feedback:read',
        label: 'Read feedback',
        description: 'Read feedback by request ID or token.',
        endpoints: ['GET /api/feedback/:requestId', 'GET /api/feedback/token/:token'],
      },
      {
        scope: 'feedback:submit',
        label: 'Submit feedback',
        description: 'Submit feedback responses by request ID or token.',
        endpoints: ['POST /api/feedback/:requestId/submit', 'POST /api/feedback/token/:token/submit'],
      },
    ],
  },
  {
    id: 'processing',
    label: 'Processing',
    description: 'Inspect processing tasks and summaries.',
    scopes: [
      {
        scope: 'processing:read',
        label: 'Read processing',
        description: 'Read processing envelope state, task details, and summaries.',
        endpoints: [
          'GET /api/processing/:requestId',
          'GET /api/processing/:requestId/tasks/:taskName',
          'GET /api/processing/:requestId/summary',
        ],
      },
    ],
  },
];

export const API_CLIENT_SCOPES = API_CLIENT_SCOPE_GROUPS.flatMap(group =>
  group.scopes.map(scope => scope.scope)
);
