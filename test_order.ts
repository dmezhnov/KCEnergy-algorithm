import { volumes_by_period } from './initial_data.example';

const firstChild = volumes_by_period.matrix_children['#значение']['взять'](1);
if (firstChild) {
    const coords = firstChild.coordinate_types['#значение'];
    console.log('First child coords count:', coords['размер']);
    for (let i = 1; i <= coords['размер']; i++) {
        const coord = coords['взять'](i);
        console.log(`  Coord ${i}: ${coord.code['#значение']} (type: ${coord.coordinate_type['#значение'].code['#значение']})`);
    }
}
