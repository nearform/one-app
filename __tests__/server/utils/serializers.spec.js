import { fromJS, Set as iSet } from 'immutable';

import { serializeClientInitialState } from '../../../src/server/utils/serializers';
import transit from '../../../src/universal/utils/transit';

jest.mock('../../../src/universal/utils/transit', () => ({
  toJSON: jest.fn((value) => JSON.stringify(value)),
}));

describe('serializeClientInitialState', () => {
  const rootModuleName = 'test-root';
  const throwError = () => {
    throw new Error('failed to serialize');
  };

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => null);
  });

  beforeEach(() => {
    transit.toJSON.mockClear();
    console.error.mockClear();
  });

  it('should serialize state', () => {
    expect.assertions(4);

    const initialState = fromJS({
      holocron: {
        loaded: iSet(),
      },
    });
    const str = serializeClientInitialState(initialState);
    expect(str).toContain('holocron');
    expect(str).toContain('loaded');
    expect(str).toMatchSnapshot();
    expect(transit.toJSON).toHaveBeenCalledTimes(1);
  });

  it('should fail to serialize state and fallback to defaults', () => {
    expect.assertions(7);

    const initialState = fromJS({
      holocron: {
        loaded: iSet(),
      },
      config: {
        rootModuleName,
      },
    });
    transit.toJSON.mockImplementationOnce(throwError);
    const str = serializeClientInitialState(initialState);
    expect(str).toContain('config');
    expect(str).toContain('rootModuleName');
    expect(str).toContain('holocron');
    expect(str).toContain('loaded');
    expect(str).toMatchSnapshot();
    expect(transit.toJSON).toHaveBeenCalledTimes(3);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('should throw if fallback state fails to serialize', () => {
    const initialState = fromJS({
      holocron: {
        loaded: iSet(),
      },
      config: {
        rootModuleName,
      },
    });
    transit.toJSON
      .mockImplementationOnce(throwError)
      .mockImplementationOnce(() => 'clear out internal state')
      .mockImplementationOnce(throwError);
    expect(() => serializeClientInitialState(initialState)).toThrow();
    expect(transit.toJSON).toHaveBeenCalledTimes(4);
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});
