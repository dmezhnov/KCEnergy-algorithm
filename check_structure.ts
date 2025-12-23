import { volumes_by_period } from './initial_data.example';

console.log('Root children:', volumes_by_period.matrix_children['#значение']['размер']);

const firstChild = volumes_by_period.matrix_children['#значение']['взять'](1);
if (firstChild) {
    console.log('\nFirst child coords:');
    const coords = firstChild.coordinate_types['#значение'];
    for (let i = 1; i <= coords['размер']; i++) {
        const coord = coords['взять'](i);
        console.log(`  ${coord.code['#значение']} (${coord.coordinate_type['#значение'].code['#значение']})`);
    }

    console.log('\nFirst child children:', firstChild.matrix_children['#значение']['размер']);

    // Show structure depth
    let current = firstChild;
    let depth = 1;
    while (current.matrix_children['#значение']['размер'] > 0) {
        current = current.matrix_children['#значение']['взять'](1);
        const coords = current.coordinate_types['#значение'];
        console.log(`\nDepth ${depth} coords (${coords['размер']} coords):`);
        for (let i = 1; i <= Math.min(3, coords['размер']); i++) {
            const coord = coords['взять'](i);
            console.log(`  ${coord.code['#значение']} (${coord.coordinate_type['#значение'].code['#значение']})`);
        }
        console.log(`  Children: ${current.matrix_children['#значение']['размер']}`);
        depth++;
        if (depth > 10) break;
    }
}
