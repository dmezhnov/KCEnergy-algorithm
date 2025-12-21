import { volumes_by_period } from './initial_data.example';

import { sum_by_axes } from './lib/operations';
import { axis, matrix } from './lib/matrix_types';
const { District, Product_category } = axis;

export const volumes_by_product_category: matrix = await sum_by_axes(volumes_by_period, Product_category);

export const volumes_by_product_category_district: matrix = await sum_by_axes(volumes_by_period, District);
