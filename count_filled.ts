import { volumes_l_t_i_k_k0_i0 } from './initial_data.example';

let filledCount = 0;
let totalCount = 0;

function countElements(matrix: any) {
    totalCount++;
    const amount = matrix.amount?.['#значение'];
    if (amount !== null && amount !== undefined) {
        filledCount++;
    }

    const children = matrix.matrix_children?.['#значение'];
    if (children && children['размер'] > 0) {
        for (let i = 1; i <= children['размер']; i++) {
            const child = children['взять'](i);
            countElements(child);
        }
    }
}

countElements(volumes_l_t_i_k_k0_i0);
console.log(`Total elements: ${totalCount}`);
console.log(`Filled elements: ${filledCount}`);
console.log(`Empty elements: ${totalCount - filledCount}`);
