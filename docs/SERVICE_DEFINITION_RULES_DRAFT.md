# SERVICE_DEFINITION_RULES.yaml - Complete Technical Blueprint

## Overview
This file documents the COMPLETE SPECIFICATION for Service Envelope YAML definitions. Every service created using the Service Envelope system MUST follow these rules. This is the definitive reference - the "Bible" for service configuration.

## Key Principles
1. **Request-Response Pipeline**: Services flow through 6 sequential envelopes (Request → Approval → Payment → Processing → Delivery → Feedback)
2. **Type Safety**: Every field has explicit types and validation rules
3. **Separation of Concerns**: Each envelope handles a specific responsibility
4. **Flexible Configuration**: Services can be minimal (request only) or complex (all 6 envelopes)
5. **Parameter Substitution**: {{parameterName}} substitution works throughout (URLs, emails, payloads, etc.)

## Missing in Current SERVICE_DEFINITION_RULES.yaml vs comprehensive-student-document-v2.yaml

### REQUEST Envelope Gaps
- ✗ Checkboxes type: minSelected, maxSelected, default array
- ✗ Dropdown type: searchable, clearable properties
- ✗ Comprehensive pattern examples
- ✗ Radio type: default, options with label/value pairs

### APPROVAL Envelope Gaps
- ✗ requiredApprovers as simple array (not objects)
- ✗ Simple all_must_approve example

### PAYMENT Envelope Gaps
- ✗ paymentProvider field documented
- ✗ charges array structure with item, amount, currency, quantity

### PROCESSING Envelope Gaps
- ✗ stopOnFailure field
- ✗ Complete API call task example with headers, payload, timeout, retries, successCodes
- ✗ Parameter substitution in headers/payload

### DELIVERY Envelope Gaps
- ✗ Status code comments (0,1,2,3 mapping)
- ✗ Nested fields within delivery methods (physical_mail.fields.mailingAddress)
- ✗ Complete field definition structure
- ✗ All three delivery method types with full configuration

### FEEDBACK Envelope Gaps
- ✗ autoCloseAfterHours field
- ✗ Expiry behavior vs auto-close behavior

### General Gaps
- ✗ Comprehensive parameter validation constraint documentation
- ✗ More detailed approval rules examples
- ✗ Email template naming conventions
- ✗ Substitution rules documentation

## Next Steps
1. Add all missing fields with complete documentation
2. Add comprehensive examples for each field type
3. Add technical rationale/why for each configuration option
4. Ensure comprehensive-student-document-v2.yaml is 100% covered
5. Make it the definitive reference that developers consult when building services
