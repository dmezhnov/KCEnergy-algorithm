import { volumes_by_period } from './initial_data.example';

import { sum_by_axes } from './matrix_operation';
import { axis, matrix } from './matrix_types';
const { District, Product_category } = axis;

export const volumes_by_product_category: matrix = sum_by_axes(volumes_by_period, Product_category);
volumes_by_product_category.matrix_title['#значение'] = 'volumes_by_product_category';

await volumes_by_product_category.save('algorithm/build/step-0.lang', false);

export const volumes_by_product_category_district: matrix = sum_by_axes(volumes_by_period, District);
volumes_by_product_category_district.matrix_title['#значение'] = 'volumes_by_product_category_district';

await volumes_by_product_category_district.save('algorithm/build/step-0.lang', true);
