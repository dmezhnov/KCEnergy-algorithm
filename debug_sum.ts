import { volumes_by_period } from './initial_data.example';
import { sum_by_axes } from './matrix_operation';
import { Axis } from './matrix_types';

console.log('=== Input matrix ===');
console.log('volumes_by_period children:', volumes_by_period.matrix_children['#значение']['размер']);

// Get all leaf nodes
function getLeaves(matrix: any, leaves: any[] = []): any[] {
    const children = matrix.matrix_children?.['#значение'];
    if (!children || children['размер'] === 0) {
        leaves.push(matrix);
    } else {
        for (let i = 1; i <= children['размер']; i++) {
            getLeaves(children['взять'](i), leaves);
        }
    }
    return leaves;
}

const inputLeaves = getLeaves(volumes_by_period);
console.log('Input leaf count:', inputLeaves.length);
console.log('Sample input leaf coords:');
for (let i = 0; i < Math.min(3, inputLeaves.length); i++) {
    const coords = inputLeaves[i].coordinate_types['#значение'];
    const coordStrs = [];
    for (let j = 1; j <= coords['размер']; j++) {
        const coord = coords['взять'](j);
        coordStrs.push(`${coord.code['#значение']}(${coord.coordinate_type['#значение'].code['#значение']})`);
    }
    console.log(`  Leaf ${i + 1}: [${coordStrs.join(', ')}] = ${inputLeaves[i].amount['#значение']}`);
}

console.log('\n=== Running sum_by_axes ===');
const result = sum_by_axes(volumes_by_period, Axis.Product_category);

console.log('\n=== Output matrix ===');
console.log('Result children:', result.matrix_children['#значение']['размер']);
console.log('Result amount:', result.amount['#значение']);

const outputLeaves = getLeaves(result);
console.log('Output leaf count:', outputLeaves.length);
console.log('Sample output leaf coords:');
for (let i = 0; i < Math.min(5, outputLeaves.length); i++) {
    const coords = outputLeaves[i].coordinate_types['#значение'];
    const coordStrs = [];
    for (let j = 1; j <= coords['размер']; j++) {
        const coord = coords['взять'](j);
        coordStrs.push(`${coord.code['#значение']}(${coord.coordinate_type['#значение'].code['#значение']})`);
    }
    console.log(`  Leaf ${i + 1}: [${coordStrs.join(', ')}] = ${outputLeaves[i].amount['#значение']}`);
}
