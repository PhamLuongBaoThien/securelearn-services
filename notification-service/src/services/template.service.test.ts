import assert from 'node:assert/strict';
import { extractVariables, renderTemplate, validateTemplate } from './template.service';
assert.deepEqual(extractVariables('Chào {{ userName }} {{amount}}'), ['userName', 'amount']);
assert.equal(renderTemplate('Chào {{userName}}', { userName: 'An' }), 'Chào An');
assert.throws(() => validateTemplate('WELCOME', 'IN_APP', undefined, '{{password}}'));
console.log('Notification template tests passed');

