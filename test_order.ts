import { volumes_l_t_i_k_k0_i0 } from './initial_data.example';

const firstChild = volumes_l_t_i_k_k0_i0.matrix_children['#значение']['взять'](1);
if (firstChild) {
    const coords = firstChild.coordinate_types['#значение'];
    console.log('First child coords count:', coords['размер']);
    for (let i = 1; i <= coords['размер']; i++) {
        const coord = coords['взять'](i);
        console.log(`  Coord ${i}: ${coord.code['#значение']} (type: ${coord.coordinate_type['#значение'].code['#значение']})`);
    }
}
