/* from emastra/forever21-scraper */
function validateInput(input) {
    if (!input) throw new Error('INPUT is missing.');

    // validate function
    const validate = (inputKey, type = 'string') => {
        const value = input[inputKey];

        if (type === 'array') {
            if (!Array.isArray(value)) {
                throw new Error(`Value of ${inputKey} should be array`);
            }
        } else if (value) {
            if (typeof value !== type) {
                throw new Error(`Value of ${inputKey} should be ${type}`);
            }
        }
    };

    // check correct types
    validate('maxItems', 'number');
    validate('location', 'string');
    validate('radius', 'number');
}

module.exports = {
    validateInput
};
