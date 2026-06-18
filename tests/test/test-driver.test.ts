import { testDriver } from '../../src/test/test-driver';
import { memoryDriver } from '../../src/drivers/memory';

testDriver('memoryDriver', () => memoryDriver());
